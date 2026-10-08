//============================================================================================================================================
//                                                   SOLIDARCAPPLICATIONHOST.CPP
//============================================================================================================================================
// 📦 Native Windows authoring application: shared SolidArc editor, document commands and a presented DX11 surface.

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <commdlg.h>
#include <shellapi.h>
#include <d3d11.h>
#include <wrl/client.h>
#include <imgui.h>
#include <imgui_impl_win32.h>
#include <imgui_impl_dx11.h>
#include "SolidArcEditorHost.h"
#include "TypefaceRegistry.h"
#include <filesystem>
#include <fstream>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>

extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND, UINT, WPARAM, LPARAM);
namespace
{
using Microsoft::WRL::ComPtr;
uint32_t         PendingWidth = 1280u, PendingHeight = 800u;
bool             ResizeRequested = false;
LRESULT CALLBACK ReceiveWindow(HWND Window, UINT Message, WPARAM Word, LPARAM Long)
{
    if (ImGui_ImplWin32_WndProcHandler(Window, Message, Word, Long)) return 1;
    if (Message == WM_SIZE && Word != SIZE_MINIMIZED)
    {
        PendingWidth    = LOWORD(Long);
        PendingHeight   = HIWORD(Long);
        ResizeRequested = true;
        return 0;
    }
    if (Message == WM_CLOSE)
    {
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(Window, Message, Word, Long);
}
void Require(bool Accepted, const char* Explanation)
{
    if (!Accepted) throw std::runtime_error(Explanation);
}
std::string EncodeUtf8(const std::wstring& Text)
{
    if (Text.empty()) return {};
    int         Length = WideCharToMultiByte(CP_UTF8, 0, Text.data(), int(Text.size()), nullptr, 0, nullptr, nullptr);
    std::string Encoded(size_t(Length), '\0');
    WideCharToMultiByte(CP_UTF8, 0, Text.data(), int(Text.size()), Encoded.data(), Length, nullptr, nullptr);
    return Encoded;
}
std::string SelectDocument(HWND Window, bool Save)
{
    wchar_t       Path[32768]{};
    OPENFILENAMEW Selection{};
    Selection.lStructSize = sizeof(Selection);
    Selection.hwndOwner   = Window;
    Selection.lpstrFilter = L"SolidArc documents (*.arc)\0*.arc\0\0";
    Selection.lpstrFile   = Path;
    Selection.nMaxFile    = 32768;
    Selection.lpstrDefExt = L"arc";
    Selection.Flags       = OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | (Save ? OFN_OVERWRITEPROMPT : OFN_FILEMUSTEXIST);
    return (Save ? GetSaveFileNameW(&Selection) : GetOpenFileNameW(&Selection)) ? EncodeUtf8(Path) : std::string{};
}
void CaptureSurface(ID3D11Device* Device, ID3D11DeviceContext* Context, IDXGISwapChain* Chain, const std::filesystem::path& Path)
{
    ComPtr<ID3D11Texture2D> Surface, Readback;
    Require(SUCCEEDED(Chain->GetBuffer(0, IID_PPV_ARGS(&Surface))), "Cannot read the presented surface");
    D3D11_TEXTURE2D_DESC Description{};
    Surface->GetDesc(&Description);
    Description.Usage          = D3D11_USAGE_STAGING;
    Description.BindFlags      = 0;
    Description.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    Require(SUCCEEDED(Device->CreateTexture2D(&Description, nullptr, &Readback)), "Cannot allocate presentation readback");
    Context->CopyResource(Readback.Get(), Surface.Get());
    D3D11_MAPPED_SUBRESOURCE Pixels{};
    Require(SUCCEEDED(Context->Map(Readback.Get(), 0, D3D11_MAP_READ, 0, &Pixels)), "Cannot map presentation readback");
    std::ofstream Stream(Path, std::ios::binary);
    Stream << "P6\n" << Description.Width << ' ' << Description.Height << "\n255\n";
    uint64_t Colour = 0u;
    for (uint32_t Row = 0u; Row < Description.Height; ++Row)
        for (uint32_t Column = 0u; Column < Description.Width; ++Column)
        {
            const auto* Pixel = static_cast<const unsigned char*>(Pixels.pData) + Row * Pixels.RowPitch + Column * 4u;
            Stream.write(reinterpret_cast<const char*>(Pixel), 3u);
            Colour += Pixel[0] + Pixel[1] + Pixel[2];
        }
    Context->Unmap(Readback.Get(), 0);
    Require(Stream.good() && Colour > uint64_t(Description.Width) * Description.Height * 20u, "Presented application surface was blank");
}
} // namespace

int WINAPI wWinMain(HINSTANCE Instance, HINSTANCE, PWSTR, int Show)
{
    HWND Window     = nullptr;
    bool ImGuiReady = false, WindowBackendReady = false, RendererReady = false;
    try
    {
        const std::filesystem::path LaunchDirectory = std::filesystem::current_path();
        wchar_t Executable[32768]{};
        GetModuleFileNameW(nullptr, Executable, 32768);
        std::filesystem::current_path(std::filesystem::path(Executable).parent_path());
        std::filesystem::path Smoke;
        std::string           Opening;
        int                   Count     = 0;
        LPWSTR*               Arguments = CommandLineToArgvW(GetCommandLineW(), &Count);
        for (int Index = 1; Index < Count; ++Index)
        {
            if (std::wstring(Arguments[Index]) == L"--smoke" && Index + 1 < Count)
                Smoke = Arguments[++Index];
            else
                Opening = EncodeUtf8(std::filesystem::absolute(LaunchDirectory / Arguments[Index]).wstring());
        }
        LocalFree(Arguments);
        if (!Smoke.empty()) std::filesystem::create_directories(Smoke);
        ImGui_ImplWin32_EnableDpiAwareness();
        WNDCLASSW Registration{};
        Registration.lpfnWndProc   = ReceiveWindow;
        Registration.hInstance     = Instance;
        Registration.lpszClassName = L"SolidArcAuthoring";
        Registration.hCursor       = LoadCursorW(nullptr, IDC_ARROW);
        Require(RegisterClassW(&Registration) != 0, "Window registration failed");
        Window = CreateWindowW(Registration.lpszClassName, L"SolidArc", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 1280, 800, nullptr,
                               nullptr, Instance, nullptr);
        Require(Window != nullptr, "Application window creation failed");
        ComPtr<ID3D11Device>        Device;
        ComPtr<ID3D11DeviceContext> Context;
        ComPtr<IDXGISwapChain>      Chain;
        DXGI_SWAP_CHAIN_DESC        Configuration{};
        Configuration.BufferCount       = 2;
        Configuration.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
        Configuration.BufferUsage       = DXGI_USAGE_RENDER_TARGET_OUTPUT;
        Configuration.OutputWindow      = Window;
        Configuration.SampleDesc.Count  = 1;
        Configuration.Windowed          = TRUE;
        Configuration.SwapEffect        = DXGI_SWAP_EFFECT_DISCARD;
        D3D_FEATURE_LEVEL Level{};
        HRESULT Created = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION,
                                                        &Configuration, &Chain, &Device, &Level, &Context);
        if (FAILED(Created))
            Created = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &Configuration,
                                                    &Chain, &Device, &Level, &Context);
        Require(SUCCEEDED(Created), "Neither hardware nor software D3D11 presentation is available");
        ComPtr<ID3D11RenderTargetView> Target;
        auto                           ConstructTarget = [&]()
        {
            ComPtr<ID3D11Texture2D> Surface;
            Require(SUCCEEDED(Chain->GetBuffer(0, IID_PPV_ARGS(&Surface))), "Back surface unavailable");
            Require(SUCCEEDED(Device->CreateRenderTargetView(Surface.Get(), nullptr, &Target)), "Presentation target unavailable");
        };
        ConstructTarget();
        IMGUI_CHECKVERSION();
        ImGui::CreateContext();
        ImGuiReady = true;
        ImGui::GetIO().ConfigFlags |= ImGuiConfigFlags_DockingEnable;
        WindowBackendReady = ImGui_ImplWin32_Init(Window);
        RendererReady      = ImGui_ImplDX11_Init(Device.Get(), Context.Get());
        Require(WindowBackendReady && RendererReady, "Editor presentation initialization failed");
        {
            Frontier::TypefaceRegistry Typefaces;
            // 📝 Extra appearance families are optional; the shared editor loads the packaged DM Sans faces.
            (void)Typefaces.Load("EngineContent/FontArchives");
            Frontier::TypefaceRegistry::Install(&Typefaces);
            Frontier::SolidArcEditorHost Editor;
            Editor.ApplyTheme();
            Editor.ShowDocumentCommands();
            Require(Editor.SeatShade(1280u, 800u), "Editor controls failed to initialize");
            Frontier::ConsoleHost Document("Documents", 600u, 400u);
            if (!Opening.empty())
                Require(Document.Execute("open \"" + Opening + "\""), "Opening document was refused");
            else
                Require(Document.Execute("box (-1,-0.5,0) (1,0.5,0.8) --name=Body01"), "Initial document failed");
            std::string                      Notice = "Ready. Select geometry, use Construct, or enter a SolidArc command.";
            char                             Command[2048]{};
            int                              FeatureChoice = 0;
            ComPtr<ID3D11Texture2D>          Preview;
            ComPtr<ID3D11ShaderResourceView> PreviewView;
            uint32_t                         PreviewWidth = 0u, PreviewHeight = 0u, Recordings = 0u;
            bool                             Running = true;
            ShowWindow(Window, Show);
            UpdateWindow(Window);
            while (Running)
            {
                MSG Message{};
                while (PeekMessageW(&Message, nullptr, 0, 0, PM_REMOVE))
                {
                    if (Message.message == WM_QUIT) Running = false;
                    TranslateMessage(&Message);
                    DispatchMessageW(&Message);
                }
                if (!Running) break;
                if (IsIconic(Window))
                {
                    Sleep(30);
                    continue;
                }
                if (ResizeRequested && PendingWidth && PendingHeight)
                {
                    Context->OMSetRenderTargets(0, nullptr, nullptr);
                    Target.Reset();
                    Require(SUCCEEDED(Chain->ResizeBuffers(0, PendingWidth, PendingHeight, DXGI_FORMAT_UNKNOWN, 0)), "Window resize failed");
                    ConstructTarget();
                    Editor.ReseatLayout();
                    ResizeRequested = false;
                }
                ImGui_ImplDX11_NewFrame();
                ImGui_ImplWin32_NewFrame();
                ImGuiIO& Contact = ImGui::GetIO();
                Editor.TickShade(Contact.MousePos.x, Contact.MousePos.y, Contact.MouseDown[0], Contact.MouseWheel, Contact.DeltaTime);
                ImGui::NewFrame();
                Editor.Record(Document);
                ImGui::SetNextWindowSize(ImVec2(760, 235), ImGuiCond_FirstUseEver);
                if (ImGui::Begin("Document commands"))
                {
                    if (ImGui::Button("Open .arc"))
                    {
                        auto Path = SelectDocument(Window, false);
                        if (!Path.empty())
                            Notice = Document.Execute("open \"" + Path + "\"") ? "Opened " + Path : "Open refused; document retained.";
                    }
                    ImGui::SameLine();
                    if (ImGui::Button("Save as .arc"))
                    {
                        auto Path = SelectDocument(Window, true);
                        if (!Path.empty()) Notice = Document.Execute("save \"" + Path + "\"") ? "Saved " + Path : "Save refused.";
                    }
                    ImGui::SameLine();
                    if (ImGui::Button("Undo")) (void)Document.Execute("undo");
                    ImGui::SameLine();
                    if (ImGui::Button("Redo")) (void)Document.Execute("redo");
                    ImGui::Separator();
                    ImGui::SetNextItemWidth(210.0f);
                    ImGui::Combo("Feature purpose", &FeatureChoice, "Design (red)\0Circular guide (cyan)\0Repair (orange)\0Off\0");
                    const char* Purposes[] = {"design", "circular", "repair", "off"};
                    ImGui::SameLine();
                    if (ImGui::Button("Apply to curves"))
                        Notice = Document.Execute(std::string("feature ") + Purposes[FeatureChoice] + " selected") ?
                            "Feature purpose recorded. This does not change body geometry." : "Select unlocked curves; circular requires an arc/circle.";
                    ImGui::SameLine();
                    if (ImGui::Button("Copy picked edges"))
                    {
                        std::string Owner;
                        for (const auto& Figure : Document.AllFigures())
                            if (!Figure.SelectedEdges.empty())
                            {
                                if (!Owner.empty()) { Owner.clear(); break; }
                                Owner = Figure.Name;
                            }
                        if (Owner.empty() || FeatureChoice == 1 || FeatureChoice == 3)
                            Notice = "Select edges on one body and choose Design or Repair.";
                        else
                            Notice = Document.Execute("feature-copy \"" + Owner + "\" " + Purposes[FeatureChoice]) ?
                                "Independent feature curves copied; body unchanged." : "Feature edge copy refused.";
                    }
                    if (ImGui::Button("Show features")) (void)Document.Execute("show features on");
                    ImGui::SameLine();
                    if (ImGui::Button("Hide features")) (void)Document.Execute("show features off");
                    ImGui::TextDisabled("Guides are editable copies, not live surface constraints. Colour is not a smoothness certificate.");
                    bool Execute = ImGui::InputText("Command", Command, sizeof(Command), ImGuiInputTextFlags_EnterReturnsTrue);
                    ImGui::SameLine();
                    Execute |= ImGui::Button("Execute");
                    if (Execute && Command[0])
                    {
                        Notice     = Document.Execute(Command) ? std::string("Executed: ") + Command : std::string("Refused: ") + Command;
                        Command[0] = 0;
                    }
                    ImGui::TextWrapped("%s", Notice.c_str());
                }
                ImGui::End();
                ImGui::Render();
                const auto& Image = Editor.QueryPresentedImage();
                if (!Image.Pixels.empty())
                {
                    if (Image.Width != PreviewWidth || Image.Height != PreviewHeight)
                    {
                        PreviewView.Reset();
                        Preview.Reset();
                        D3D11_TEXTURE2D_DESC Description{};
                        Description.Width     = Image.Width;
                        Description.Height    = Image.Height;
                        Description.MipLevels = Description.ArraySize = 1;
                        Description.Format                            = DXGI_FORMAT_R8G8B8A8_UNORM;
                        Description.SampleDesc.Count                  = 1;
                        Description.Usage                             = D3D11_USAGE_DYNAMIC;
                        Description.BindFlags                         = D3D11_BIND_SHADER_RESOURCE;
                        Description.CPUAccessFlags                    = D3D11_CPU_ACCESS_WRITE;
                        Require(SUCCEEDED(Device->CreateTexture2D(&Description, nullptr, &Preview)), "Viewport texture allocation failed");
                        Require(SUCCEEDED(Device->CreateShaderResourceView(Preview.Get(), nullptr, &PreviewView)),
                                "Viewport texture view failed");
                        PreviewWidth  = Image.Width;
                        PreviewHeight = Image.Height;
                    }
                    D3D11_MAPPED_SUBRESOURCE Pixels{};
                    Require(SUCCEEDED(Context->Map(Preview.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &Pixels)), "Viewport upload failed");
                    for (uint32_t Row = 0; Row < Image.Height; ++Row)
                        memcpy(static_cast<char*>(Pixels.pData) + Row * Pixels.RowPitch, Image.Pixels.data() + size_t(Row) * Image.Width * 4u,
                               Image.Width * 4u);
                    Context->Unmap(Preview.Get(), 0);
                    for (ImDrawList* Commands : ImGui::GetDrawData()->CmdLists)
                        for (ImDrawCmd& Draw : Commands->CmdBuffer)
                            if (!Draw.TexRef._TexData && Draw.TexRef._TexID == ImTextureID(reinterpret_cast<uintptr_t>(Image.Pixels.data())))
                                Draw.TexRef = ImTextureRef(ImTextureID(reinterpret_cast<uintptr_t>(PreviewView.Get())));
                }
                const float             Background[4] = {0.02f, 0.02f, 0.02f, 1.0f};
                ID3D11RenderTargetView* Active        = Target.Get();
                Context->OMSetRenderTargets(1, &Active, nullptr);
                Context->ClearRenderTargetView(Target.Get(), Background);
                ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
                if (!Smoke.empty() && Recordings == 5u)
                {
                    Require(ImGui::GetDrawData()->TotalVtxCount > 100 && Editor.QueryViewWidth() > 100 && !Image.Pixels.empty(),
                            "Editor did not present its document");
                    CaptureSurface(Device.Get(), Context.Get(), Chain.Get(), Smoke / "SolidArc.ppm");
                    Require(Editor.PlaceConstruct(Document, 0u), "Construct action failed");
                    Require(Document.Execute("save \"" + EncodeUtf8((Smoke / L"RoundTrip.arc").wstring()) + "\""), "Document save failed");
                    Require(Document.Execute("open \"" + EncodeUtf8((Smoke / L"RoundTrip.arc").wstring()) + "\""), "Document reopen failed");
                    SetWindowPos(Window, nullptr, 0, 0, 1100, 740, SWP_NOMOVE | SWP_NOZORDER);
                }
                if (!Smoke.empty() && Recordings == 10u)
                {
                    CaptureSurface(Device.Get(), Context.Get(), Chain.Get(), Smoke / "SolidArcResized.ppm");
                    std::ofstream(Smoke / "Execution.log")
                        << "PASS native SolidArc window, shared editor, viewport presentation, Construct, save/reopen and resize\n";
                    Running = false;
                }
                Require(SUCCEEDED(Chain->Present(1, 0)), "Presentation failed");
                ++Recordings;
            }
            Frontier::TypefaceRegistry::Install(nullptr);
        }
        ImGui_ImplDX11_Shutdown();
        RendererReady = false;
        ImGui_ImplWin32_Shutdown();
        WindowBackendReady = false;
        ImGui::DestroyContext();
        ImGuiReady = false;
        DestroyWindow(Window);
        Window = nullptr;
        UnregisterClassW(L"SolidArcAuthoring", Instance);
        return 0;
    }
    catch (const std::exception& Error)
    {
        if (RendererReady) ImGui_ImplDX11_Shutdown();
        if (WindowBackendReady) ImGui_ImplWin32_Shutdown();
        if (ImGuiReady) ImGui::DestroyContext();
        std::fprintf(stderr, "SolidArc refused: %s\n", Error.what());
        if (!GetEnvironmentVariableW(L"GITHUB_ACTIONS", nullptr, 0))
            MessageBoxA(Window, Error.what(), "SolidArc startup refused", MB_OK | MB_ICONERROR);
        if (Window) DestroyWindow(Window);
        return 1;
    }
}
