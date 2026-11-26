//==========================================================================================================================================
//                                                            OVERVIEWPAGE.JS
//==========================================================================================================================================
// 🧩 Page 1 of Overview.md: the project laid out like the first page of a printed report — a cover with the project's icon and name,
// the facts at a glance, the hero render, a contents list (levels with their renders, then the document pages), the build settings read from page 2 (Project
// details), and the version history. Everything links: a contents line, a level or "Edit on page …" turns to that page.

function ConstructOverviewPage(Surface)
{
    const Details = QueryProjectDetailsEnabled() ? RetrieveProjectDetails(Selected) : null;
    const Version = Selected.Revisions.length - ActiveRevision;
    const Levels = Selected.Views.length;
    const RailName = Query('#RailTitle').textContent;
    const DetailsPage = Levels + 2;
    const Application = Applications[QueryApplication(Selected)].Title;
    const Mark = Details?.Project.Icon ? `<img src="${Escape(Details.Project.Icon)}" alt="">` : `<span>${Escape((Details?.Project.Name || Selected.Title).trim().charAt(0).toUpperCase() || 'P')}</span>`;
    const Shot = Index => SnapshotCache.get(SnapshotKey(Selected, Index, ActiveRevision));
    const Picture = Index => Shot(Index) ? `<img src="${Escape(Shot(Index))}" alt="">` : `<span class="ov-pending">${Icon('cube')}</span>`;
    const Glance = [
        [RailName, String(Levels)],
        ['Version', Details?.Project.Version || `${Version}`],
        ['Resolution', Details ? `${Details.Render.Width} × ${Details.Render.Height}` : '—'],
        ['Opens in', Application]
    ];
    const Contents = [
        ...Selected.Views.map((Name, Index) => [Name, `${RailName.replace(/s$/, '')} ${String(Index + 1).padStart(2, '0')}`, Index + 1]),
        ['Overview', 'This page', Levels + 1],
        ...(Details ? [['Project details', 'Identity, render, online services, terms', DetailsPage]] : [])
    ];
    const Services = Details && QueryOnlineServicesEnabled() ? [['Epic Online Services', Details.Online.Eos.Enabled], ['Photon multiplayer', Details.Online.Photon.Enabled]] : [];
    let Section = 0;
    const Heading = Title => `<h2 class="ov-heading"><span>${String(++Section).padStart(2, '0')}</span>${Escape(Title)}</h2>`;
    Surface.innerHTML = `<article class="overview-doc">
        <header class="ov-cover">
            <div class="ov-mark">${Mark}</div>
            <div class="ov-cover-text">
                <span class="ov-eyebrow">Project overview · ${Escape(Selected.Extension)}</span>
                <h1>${Escape(Details?.Project.Name || Selected.Title)}</h1>
                <p class="ov-lede">${Escape(Details?.Project.Description || Selected.Description)}</p>
                ${Details?.Project.Publisher ? `<p class="ov-byline">${Escape(Details.Project.Publisher)}</p>` : ''}
            </div>
        </header>
        <dl class="ov-glance">${Glance.map(([Term, Detail]) => `<div><dt>${Escape(Term)}</dt><dd>${Escape(Detail)}</dd></div>`).join('')}</dl>
        <figure class="ov-hero" data-goto-page="1">${Picture(0)}<figcaption><b>Figure 1</b> ${Escape(Selected.Views[0] || '')} · version ${Version} · browser reference render (WebGL 2), not the native renderer</figcaption></figure>

        <div class="ov-columns">
            <section>
                ${Heading('Contents')}
                <ol class="ov-contents">${Contents.map(([Name, Caption, Page], Index) => `<li><button type="button" data-goto-page="${Page}">${Index < Levels ? `<span class="ov-thumb">${Picture(Index)}</span>` : `<span class="ov-thumb ov-thumb-page">${Icon('file')}</span>`}<span class="ov-entry"><b>${Escape(Name)}</b><small>${Escape(Caption)}</small></span><i></i><span class="ov-page">${Page}</span></button></li>`).join('')}</ol>
            </section>
            <section>
                ${Details ? `${Heading('Build')}
                <dl class="ov-build">
                    <dt>Package</dt><dd class="mono">${Escape(Details.Project.PackageName || '—')}</dd>
                    <dt>Window</dt><dd>${Escape(WindowModes[+Details.Render.WindowMode] || '—')} · ${Escape(Details.Render.FrameRate === 'Unlimited' ? 'unlimited fps' : Details.Render.FrameRate + ' fps')}${Details.Render.VSync ? ' · V-Sync' : ''}</dd>
                    ${Services.map(([Name, On]) => `<dt>${Escape(Name)}</dt><dd><span class="ov-state${On ? ' on' : ''}">${On ? 'On' : 'Off'}</span></dd>`).join('')}
                    <dt>Terms</dt><dd>${Details.Legal.Terms.trim() ? `${Details.Legal.Terms.trim().split(/\s+/).length} words${Details.Legal.RequireAcceptance ? ' · accepted at launch' : ''}` : 'Not written yet'}</dd>
                </dl>
                <button type="button" class="ov-link" data-goto-page="${DetailsPage}">Edit on page ${DetailsPage} →</button>` : ''}
            </section>
        </div>

        ${Heading('History')}
        <ol class="ov-history">${Selected.Revisions.map((Label, Index) => `<li class="${Index === ActiveRevision ? 'current' : ''}"><span class="ov-dot"></span><b>Version ${Selected.Revisions.length - Index}</b><span>${Escape(Label)}</span></li>`).join('')}</ol>

    </article>`;
    Surface.querySelectorAll('[data-goto-page]').forEach(Target => Target.addEventListener('click', () => ConfigurePage(Number(Target.dataset.gotoPage) - 1)));
}
