//==========================================================================================================================================
//                                                            PROJECTDETAILS.JS
//==========================================================================================================================================
// 🧩 Page 2 of Overview.md: the project's details as an editable document page — identity and icon, render resolution, the online
// services (Epic Online Services, Photon) and the terms and conditions. Every edit is kept at once (browser storage, per project) in the
// shape of Content/Project.json, so testing or packaging the project finds it already filled in. 📝 Browser prototype: the file is
// offered as a download; writing it into the project's Content folder belongs to the native editor.

const ProjectDetailsKey = 'frontier.browser.projectDetails';
const ProjectDetailsFile = 'Content/Project.json';
let ProjectDetailsRecords = null;
// Read on first use: this file loads before Browser.js, whose storage helpers it uses.
function QueryProjectDetailsStore()
{
    return ProjectDetailsRecords ??= RetrievePreference(ProjectDetailsKey, {});
}
let ProjectDetailsTimer = 0;
let ProjectDetailsSavedAt = 0;

const RenderResolutions = [[1280, 720, 'HD'], [1920, 1080, 'Full HD'], [2560, 1440, 'QHD'], [3840, 2160, '4K UHD']];
const WindowModes = ['Fullscreen', 'Borderless window', 'Windowed'];
const FrameRates = ['30', '60', '120', '144', 'Unlimited'];
// Photon Cloud regions (photonengine.com · Regions) plus "best region" (lowest ping at connect).
const PhotonRegions = [['', 'Best region (lowest ping)'], ['eu', 'Europe · Amsterdam'], ['us', 'USA East · Washington'], ['usw', 'USA West · San José'], ['ussc', 'USA South Central · Dallas'], ['cae', 'Canada East · Montreal'], ['sa', 'South America · São Paulo'], ['za', 'South Africa · Johannesburg'], ['uae', 'UAE · Dubai'], ['in', 'India · Chennai'], ['asia', 'Asia · Singapore'], ['jp', 'Japan · Tokyo'], ['kr', 'South Korea · Seoul'], ['hk', 'Hong Kong'], ['au', 'Australia · Sydney'], ['tr', 'Türkiye · Istanbul']];
// Photon Server's default listener per protocol (master server).
const PhotonProtocols = [['Udp', 'UDP', 5055], ['Tcp', 'TCP', 4530], ['WebSocket', 'WebSocket', 9090], ['WebSocketSecure', 'WebSocket Secure', 19090]];

function QueryProjectDetailsEnabled()
{
    return !!Selected && Selected.Category !== 'document';
}
function QueryOnlineServicesEnabled()
{
    return !!Selected && Selected.Category === 'project';
}
function ResolveHexKey(Bytes)
{
    const Values = new Uint8Array(Bytes);
    crypto.getRandomValues(Values);
    return [...Values].map(Value => Value.toString(16).padStart(2, '0')).join('');
}
function ResolvePackageName(Title)
{
    const Slug = String(Title || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return `com.frontier.${Slug || 'project'}`;
}

// The defaults a project starts with; a saved record is laid over them, so fields added later still appear.
function ResolveProjectDefaults(Entry)
{
    return {
        Schema: 'frontier.project/1',
        Project: { Name: Entry.Title, Id: crypto.randomUUID ? crypto.randomUUID() : ResolveHexKey(16), PackageName: ResolvePackageName(Entry.Title), Version: '0.1.0', Publisher: '', Description: Entry.Description || '', Icon: null },
        Render: { Width: 1920, Height: 1080, WindowMode: 0, FrameRate: '60', VSync: true, DefaultLevel: 0 },
        Online: {
            Eos: { Enabled: false, ProductName: Entry.Title, ProductVersion: '0.1.0', ProductId: '', SandboxId: '', DeploymentId: '', ClientId: '', ClientSecret: '', EncryptionKey: '' },
            Photon: { Enabled: false, Hosting: 'Cloud', AppId: '', AppVersion: '1.0', FixedRegion: '', ServerAddress: '127.0.0.1', Protocol: 'Udp', Port: 5055 }
        },
        Legal: { Terms: '', RequireAcceptance: true, PrivacyUrl: '', SupportEmail: '' },
        SavedAt: null
    };
}
function ResolveMerged(Base, Saved)
{
    if (!Saved || typeof Saved !== 'object' || Array.isArray(Saved)) return Base;
    const Result = Array.isArray(Base) ? [...Base] : { ...Base };
    for (const [Key, Value] of Object.entries(Saved))
        Result[Key] = Base && typeof Base[Key] === 'object' && Base[Key] !== null && !Array.isArray(Base[Key]) ? ResolveMerged(Base[Key], Value) : Value;
    return Result;
}
function RetrieveProjectDetails(Entry)
{
    if (!QueryProjectDetailsStore()[Entry.Token])
    {
        // A project gets its record (and its Project ID) the first time it is opened, so a test run already has one.
        QueryProjectDetailsStore()[Entry.Token] = ResolveProjectDefaults(Entry);
        QueryProjectDetailsStore()[Entry.Token].SavedAt = new Date().toISOString();
        PersistPreference(ProjectDetailsKey, QueryProjectDetailsStore());
    }
    return ResolveMerged(ResolveProjectDefaults(Entry), QueryProjectDetailsStore()[Entry.Token]);
}
function RetainProjectDetails(Entry, Details)
{
    Details.SavedAt = new Date().toISOString();
    QueryProjectDetailsStore()[Entry.Token] = Details;
    PersistPreference(ProjectDetailsKey, QueryProjectDetailsStore());
    ProjectDetailsSavedAt = Date.now();
    ConstructProjectSaveLine(Details);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     FORM
//------------------------------------------------------------------------------------------------------------------------

// Every input carries data-path (e.g. "Online.Eos.ClientId"); reading and writing go through it.
function QueryPath(Record, Path)
{
    return Path.split('.').reduce((At, Key) => (At == null ? undefined : At[Key]), Record);
}
function ConfigurePath(Record, Path, Next)
{
    const Keys = Path.split('.');
    const Last = Keys.pop();
    Keys.reduce((At, Key) => (At[Key] ??= {}), Record)[Last] = Next;
}
function ConstructFormRow(Label, Control, Hint = '')
{
    return `<div class="form-row"><label>${Escape(Label)}${Hint ? `<small>${Escape(Hint)}</small>` : ''}</label><div class="form-control">${Control}</div></div>`;
}
function ConstructTextInput(Details, Path, Placeholder = '', Extra = '')
{
    return `<input type="text" data-path="${Path}" value="${Escape(QueryPath(Details, Path) ?? '')}" placeholder="${Escape(Placeholder)}" spellcheck="false" autocomplete="off" ${Extra}>`;
}
function ConstructSecretInput(Details, Path, Placeholder = '')
{
    return `<span class="secret-field"><input type="password" data-path="${Path}" value="${Escape(QueryPath(Details, Path) ?? '')}" placeholder="${Escape(Placeholder)}" spellcheck="false" autocomplete="off"><button type="button" class="form-link" data-reveal title="Show or hide">Show</button></span>`;
}
function ConstructSelect(Details, Path, Options)
{
    const Current = String(QueryPath(Details, Path));
    return `<select data-path="${Path}">${Options.map(([Value, Caption]) => `<option value="${Escape(Value)}"${String(Value) === Current ? ' selected' : ''}>${Escape(Caption)}</option>`).join('')}</select>`;
}
function ConstructCheck(Details, Path, Caption)
{
    return `<label class="form-check"><input type="checkbox" data-path="${Path}"${QueryPath(Details, Path) ? ' checked' : ''}><span>${Escape(Caption)}</span></label>`;
}
function ConstructSegments(Details, Path, Options)
{
    const Current = String(QueryPath(Details, Path));
    return `<span class="form-segments" role="radiogroup">${Options.map(([Value, Caption]) => `<button type="button" role="radio" data-segment="${Path}" data-value="${Escape(Value)}" aria-checked="${String(Value) === Current}">${Escape(Caption)}</button>`).join('')}</span>`;
}
function ConstructProjectIcon(Details)
{
    const Image = Details.Project.Icon;
    return `<div class="icon-well">${Image ? `<img src="${Escape(Image)}" alt="Project icon">` : `<span class="icon-empty">${Icon('cube')}<small>No icon</small></span>`}</div>
        <div class="icon-tools"><button type="button" class="form-link" data-icon="choose">Choose image…</button><button type="button" class="form-link" data-icon="render">Use current render</button>${Image ? '<button type="button" class="form-link" data-icon="clear">Remove</button>' : ''}<small>Square · stored at 256 × 256 PNG</small><input type="file" accept="image/*" hidden data-icon-file></div>`;
}

function ConstructPhotonEndpoint(Details)
{
    // Photon Cloud picks a region; a self-hosted Photon Server is reached by address, protocol and port.
    if (Details.Online.Photon.Hosting !== 'SelfHosted') return ConstructFormRow('Region', ConstructSelect(Details, 'Online.Photon.FixedRegion', PhotonRegions));
    const Address = ConstructFormRow('Server address', ConstructTextInput(Details, 'Online.Photon.ServerAddress', 'game.example.com', 'class="mono"'));
    const Protocol = ConstructSelect(Details, 'Online.Photon.Protocol', PhotonProtocols.map(([Value, Caption]) => [Value, Caption]));
    const Port = `<input type="number" min="1" max="65535" data-path="Online.Photon.Port" value="${+Details.Online.Photon.Port}" aria-label="Port" class="port-field">`;
    return Address + ConstructFormRow('Protocol', `<span class="inline-field">${Protocol}${Port}</span>`, 'Port follows the protocol');
}
function ConstructProjectDetails(Surface)
{
    const Details = RetrieveProjectDetails(Selected);
    const Resolution = RenderResolutions.findIndex(([Width, Height]) => Width === +Details.Render.Width && Height === +Details.Render.Height);
    const Eos = Details.Online.Eos, Photon = Details.Online.Photon;
    const SelfHosted = Photon.Hosting === 'SelfHosted';
    let Section = 0;
    const Heading = Title => `<h2 class="form-heading"><span>${++Section}</span>${Escape(Title)}</h2>`;
    Surface.innerHTML = `<form class="project-form" autocomplete="off" aria-label="Project details">
        <header class="form-title"><h1>Project details</h1><p>What the packaged product is built from. Edits are kept as you type.</p><p class="form-saved" id="ProjectSaved"></p></header>
        ${Heading('Identity')}
        <div class="form-identity">
            <div class="form-icon">${ConstructProjectIcon(Details)}</div>
            <div class="form-rows">
                ${ConstructFormRow('Project name', ConstructTextInput(Details, 'Project.Name', Selected.Title))}
                ${ConstructFormRow('Project ID', `<span class="id-field">${ConstructTextInput(Details, 'Project.Id', '', 'readonly class="mono"')}<button type="button" class="form-link" data-generate="Project.Id" title="Generate a new Project ID">New</button></span>`, 'Unique · used by saves and services')}
                ${ConstructFormRow('Package name', ConstructTextInput(Details, 'Project.PackageName', 'com.studio.game', 'class="mono"'))}
                ${ConstructFormRow('Version', ConstructTextInput(Details, 'Project.Version', '0.1.0'))}
                ${ConstructFormRow('Publisher', ConstructTextInput(Details, 'Project.Publisher', 'Studio name'))}
            </div>
        </div>
        ${ConstructFormRow('Description', `<textarea data-path="Project.Description" rows="2" placeholder="One or two lines for the store page">${Escape(Details.Project.Description || '')}</textarea>`)}

        ${Heading('Render')}
        ${ConstructFormRow('Resolution', `<span class="resolution-field">${ConstructSelect({ R: Resolution < 0 ? 'custom' : String(Resolution) }, 'R', [...RenderResolutions.map(([Width, Height, Caption], Index) => [String(Index), `${Width} × ${Height} · ${Caption}`]), ['custom', 'Custom']]).replace('data-path="R"', 'data-resolution')}<input type="number" min="320" max="7680" step="2" data-path="Render.Width" value="${+Details.Render.Width}" aria-label="Width"><i>×</i><input type="number" min="240" max="4320" step="2" data-path="Render.Height" value="${+Details.Render.Height}" aria-label="Height"></span>`, 'Default output · render and window')}
        ${ConstructFormRow('Window', ConstructSelect(Details, 'Render.WindowMode', WindowModes.map((Caption, Index) => [String(Index), Caption])))}
        ${ConstructFormRow('Frame rate', `<span class="inline-field">${ConstructSelect(Details, 'Render.FrameRate', FrameRates.map(Rate => [Rate, Rate === 'Unlimited' ? Rate : Rate + ' fps']))}${ConstructCheck(Details, 'Render.VSync', 'V-Sync')}</span>`)}
        ${ConstructFormRow(({ project: 'Start level', cad: 'Start view', geometry: 'Start view' })[Selected.Category] || 'Start view', ConstructSelect(Details, 'Render.DefaultLevel', Selected.Views.map((Name, Index) => [String(Index), `${Index + 1} · ${Name}`])))}

        ${QueryOnlineServicesEnabled() ? `${Heading('Online services')}
        <section class="form-service${Eos.Enabled ? '' : ' is-off'}" data-service="Eos">
            <header>${ConstructCheck(Details, 'Online.Eos.Enabled', 'Epic Online Services')}<small>From the Epic Developer Portal · Product Settings</small></header>
            <div class="form-service-body">
                ${ConstructFormRow('Product name', ConstructTextInput(Details, 'Online.Eos.ProductName'))}
                ${ConstructFormRow('Product version', ConstructTextInput(Details, 'Online.Eos.ProductVersion', '0.1.0'))}
                ${ConstructFormRow('Product ID', ConstructTextInput(Details, 'Online.Eos.ProductId', '32 characters', 'class="mono"'))}
                ${ConstructFormRow('Sandbox ID', ConstructTextInput(Details, 'Online.Eos.SandboxId', '32 characters', 'class="mono"'))}
                ${ConstructFormRow('Deployment ID', ConstructTextInput(Details, 'Online.Eos.DeploymentId', '32 characters', 'class="mono"'))}
                ${ConstructFormRow('Client ID', ConstructTextInput(Details, 'Online.Eos.ClientId', 'xyza…', 'class="mono"'))}
                ${ConstructFormRow('Client secret', ConstructSecretInput(Details, 'Online.Eos.ClientSecret', 'Client policy secret'))}
                ${ConstructFormRow('Encryption key', `<span class="id-field">${ConstructTextInput(Details, 'Online.Eos.EncryptionKey', '64 hex characters', 'class="mono"')}<button type="button" class="form-link" data-generate="Online.Eos.EncryptionKey" title="Generate a 256-bit key">Generate</button></span>`, 'Player data storage · 256-bit')}
            </div>
        </section>
        <section class="form-service${Photon.Enabled ? '' : ' is-off'}" data-service="Photon">
            <header>${ConstructCheck(Details, 'Online.Photon.Enabled', 'Photon multiplayer')}<small>Photon Cloud App ID, or your own Photon Server</small></header>
            <div class="form-service-body">
                ${ConstructFormRow('Hosting', ConstructSegments(Details, 'Online.Photon.Hosting', [['Cloud', 'Photon Cloud'], ['SelfHosted', 'Self-hosted server']]))}
                ${ConstructFormRow('App ID', ConstructTextInput(Details, 'Online.Photon.AppId', '00000000-0000-0000-0000-000000000000', 'class="mono"'), SelfHosted ? 'Optional on your own server' : 'From the Photon dashboard')}
                ${ConstructFormRow('App version', ConstructTextInput(Details, 'Online.Photon.AppVersion', '1.0'), 'Players only meet the same version')}
                ${ConstructPhotonEndpoint(Details)}
            </div>
        </section>` : ''}

        ${Heading('Terms and conditions')}
        <textarea class="terms-text" data-path="Legal.Terms" rows="9" placeholder="End-user licence agreement shown to players. Plain text; blank lines start new paragraphs.">${Escape(Details.Legal.Terms || '')}</textarea>
        ${ConstructFormRow('At first launch', ConstructCheck(Details, 'Legal.RequireAcceptance', 'Players must accept before playing'))}
        ${ConstructFormRow('Privacy policy', ConstructTextInput(Details, 'Legal.PrivacyUrl', 'https://'))}
        ${ConstructFormRow('Support e-mail', ConstructTextInput(Details, 'Legal.SupportEmail', 'support@studio.com'))}

        <footer class="form-actions"><span>Packaging reads <b>${ProjectDetailsFile}</b>.</span><button type="button" class="form-button" data-download>Download Project.json</button></footer>
    </form>`;
    ConstructProjectSaveLine(Details);
    ConfigureProjectForm(Surface.querySelector('.project-form'), Details);
}
function ConstructProjectSaveLine(Details)
{
    const Line = Query('#ProjectSaved');
    if (!Line) return;
    const Time = Details.SavedAt ? new Date(Details.SavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    Line.innerHTML = `<span class="saved-dot"></span>Saved · ${ProjectDetailsFile} · ${Escape(Time)}`;
    Line.classList.remove('pulse');
    void Line.offsetWidth;
    if (Date.now() - ProjectDetailsSavedAt < 400) Line.classList.add('pulse');
}

function ConfigureProjectForm(Form, Details)
{
    const Keep = (Rebuild = false) =>
    {
        clearTimeout(ProjectDetailsTimer);
        ProjectDetailsTimer = setTimeout(() =>
        {
            RetainProjectDetails(Selected, Details);
            if (Rebuild) ConstructPreview();
            else ConstructPageChrome();
        }, Rebuild ? 0 : 260);
    };
    Form.addEventListener('input', Event =>
    {
        const Field = Event.target;
        if (Field.matches('[data-resolution]'))
        {
            const Preset = RenderResolutions[+Field.value];
            if (Preset) { Details.Render.Width = Preset[0]; Details.Render.Height = Preset[1]; Form.querySelector('[data-path="Render.Width"]').value = Preset[0]; Form.querySelector('[data-path="Render.Height"]').value = Preset[1]; }
            return Keep();
        }
        if (!Field.dataset.path) return;
        const Path = Field.dataset.path;
        const Next = Field.type === 'checkbox' ? Field.checked : Field.type === 'number' ? Number(Field.value) : Field.value;
        ConfigurePath(Details, Path, Next);
        if (Path === 'Render.Width' || Path === 'Render.Height')
        {
            const At = RenderResolutions.findIndex(([Width, Height]) => Width === +Details.Render.Width && Height === +Details.Render.Height);
            Form.querySelector('[data-resolution]').value = At < 0 ? 'custom' : String(At);
        }
        if (Path === 'Online.Photon.Protocol')
        {
            Details.Online.Photon.Port = PhotonProtocols.find(([Value]) => Value === Next)?.[2] ?? Details.Online.Photon.Port;
            Form.querySelector('[data-path="Online.Photon.Port"]').value = Details.Online.Photon.Port;
        }
        if (Path.endsWith('.Enabled')) Field.closest('.form-service')?.classList.toggle('is-off', !Next);
        Keep();
    });
    Form.addEventListener('click', Event =>
    {
        const Button = Event.target.closest('button');
        if (!Button) return;
        if (Button.dataset.segment)
        {
            ConfigurePath(Details, Button.dataset.segment, Button.dataset.value);
            return Keep(true);
        }
        if (Button.hasAttribute('data-reveal'))
        {
            const Field = Button.previousElementSibling;
            Field.type = Field.type === 'password' ? 'text' : 'password';
            Button.textContent = Field.type === 'password' ? 'Show' : 'Hide';
            return;
        }
        if (Button.dataset.generate)
        {
            const Next = Button.dataset.generate === 'Project.Id' ? (crypto.randomUUID ? crypto.randomUUID() : ResolveHexKey(16)) : ResolveHexKey(32);
            ConfigurePath(Details, Button.dataset.generate, Next);
            Form.querySelector(`[data-path="${Button.dataset.generate}"]`).value = Next;
            return Keep();
        }
        if (Button.dataset.icon === 'choose') return Form.querySelector('[data-icon-file]').click();
        if (Button.dataset.icon === 'clear') { Details.Project.Icon = null; return Keep(true); }
        if (Button.dataset.icon === 'render')
        {
            const Source = SnapshotCache.get(SnapshotKey(Selected, +Details.Render.DefaultLevel || 0, ActiveRevision)) || SnapshotCache.get(SnapshotKey(Selected, 0, ActiveRevision));
            if (!Source) return Notify('Open a level page first so its render can be captured.');
            return ResolveSquareIcon(Source).then(Url => { Details.Project.Icon = Url; Keep(true); });
        }
        if (Button.hasAttribute('data-download')) return DownloadProjectDetails(Details);
    });
    Form.querySelector('[data-icon-file]').addEventListener('change', Event =>
    {
        const File = Event.target.files?.[0];
        if (!File) return;
        const Reader = new FileReader();
        Reader.onload = () => ResolveSquareIcon(Reader.result).then(Url => { Details.Project.Icon = Url; Keep(true); }).catch(() => Notify('That image could not be read.'));
        Reader.readAsDataURL(File);
    });
    Form.addEventListener('submit', Event => Event.preventDefault());
}
// Centre-crops any picture to a 256 px square PNG so the record stays small.
function ResolveSquareIcon(Source)
{
    return new Promise((Resolve, Reject) =>
    {
        const Picture = new Image();
        Picture.onload = () =>
        {
            const Side = 256, Canvas = document.createElement('canvas');
            Canvas.width = Canvas.height = Side;
            const Short = Math.min(Picture.naturalWidth, Picture.naturalHeight);
            Canvas.getContext('2d').drawImage(Picture, (Picture.naturalWidth - Short) / 2, (Picture.naturalHeight - Short) / 2, Short, Short, 0, 0, Side, Side);
            Resolve(Canvas.toDataURL('image/png'));
        };
        Picture.onerror = Reject;
        Picture.src = Source;
    });
}
function DownloadProjectDetails(Details)
{
    const Link = document.createElement('a');
    Link.href = URL.createObjectURL(new Blob([JSON.stringify(Details, null, 2)], { type: 'application/json' }));
    Link.download = 'Project.json';
    Link.click();
    setTimeout(() => URL.revokeObjectURL(Link.href), 1000);
    Notify('Project.json downloaded.');
}
