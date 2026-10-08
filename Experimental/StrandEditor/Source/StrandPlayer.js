//============================================================================================================================================
//                                                              STRANDPLAYER.JS
//============================================================================================================================================
// 📦 Full-window loop player for a saved scene, the entry point play.html uses to embed a scene.

import { SceneFromJson } from './SceneModel.js';
import { BuildPreset } from './Presets.js';
import { StrandRenderer } from './StrandRenderer.js';
import { PlaybackTimeline } from './PlaybackTimeline.js';

const Params = new URLSearchParams(window.location.search);
const Canvas = document.getElementById('Canvas');

async function LoadScene() {
    const Source = Params.get('scene');
    if (!Source) return BuildPreset(Number(Params.get('preset') || 0));
    const Response = await fetch(Source);
    if (!Response.ok) throw new Error('Scene could not be loaded (' + Response.status + ').');
    return SceneFromJson(await Response.text());
}

async function Start() {
    const Scene = await LoadScene();
    const Renderer = new StrandRenderer(Canvas);
    const Timeline = new PlaybackTimeline();
    let Last = 0;
    const Frame = (Now) => {
        const Delta = Last ? Math.min(0.25, (Now - Last) / 1000) : 0;
        Last = Now;
        Timeline.Advance(Delta, Scene);
        Renderer.Draw(Scene, Timeline.Seconds);
        requestAnimationFrame(Frame);
    };
    requestAnimationFrame(Frame);
    window.StrandPlayer = { Ready: true, Name: Scene.Name, LoopSeconds: Scene.Playback.LoopSeconds };
}

Start().catch((Failure) => {
    document.body.dataset.error = String(Failure.message || Failure);
    console.error(Failure);
});
