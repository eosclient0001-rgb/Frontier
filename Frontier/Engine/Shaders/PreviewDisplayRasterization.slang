//==========================================================================================================================================
//                                                PREVIEW DISPLAY RASTERIZATION
//==========================================================================================================================================
// 🧩 GPU-only preview presentation: exposure, ACES filmic mapping, and sRGB encoding directly into the viewport image.

[[vk::binding(0, 0)]] [format("rgba16f")] RWTexture2DArray<float4> PreviewRadiance;
[[vk::binding(1, 0)]] [format("rgba8")]   RWTexture2D<float4>      ViewportTarget;

struct PreviewDisplayPush
{
    uint4  Counts; // {Width, Height, Reserved, Reserved}
    float4 Tuning; // {ExposureScale, Reserved, Reserved, Reserved}
};

[[vk::push_constant]] ConstantBuffer<PreviewDisplayPush> Push;

float3 ResolvePreviewSrgb(float3 LinearRadiance, float ExposureScale)
{
    float3 Exposed = max(float3(0.0f), LinearRadiance * ExposureScale);
    float3 Filmic  = saturate((Exposed * (2.51f * Exposed + 0.03f)) /
                              max(Exposed * (2.43f * Exposed + 0.59f) + 0.14f, float3(1.0e-5f)));
    float3 Low     = Filmic * 12.92f;
    float3 High    = 1.055f * pow(max(Filmic, float3(1.0e-6f)), float3(1.0f / 2.4f)) - 0.055f;
    return select(Filmic <= float3(0.0031308f), Low, High);
}

[shader("compute")]
[numthreads(8, 8, 1)]
void ResolvePreviewDisplayMain(uint3 Invocation : SV_DispatchThreadID)
{
    if (Invocation.x >= Push.Counts.x || Invocation.y >= Push.Counts.y)
    {
        return;
    }

    float3 Radiance          = PreviewRadiance[uint3(Invocation.xy, 0u)].rgb;
    ViewportTarget[Invocation.xy] = float4(ResolvePreviewSrgb(Radiance, Push.Tuning.x), 1.0f);
}
