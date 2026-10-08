//============================================================================================================================================
//                                                            PLAYBACKTIMELINE.JS
//============================================================================================================================================
// 📦 Loop clock for the editor and the player: play, pause, scrub and speed, always wrapped to the loop.

export class PlaybackTimeline {
    constructor() {
        this.Seconds = 0;
        this.Playing = true;
    }

    // 📝 The clock advances in scene time, so a loop always lasts Playback.LoopSeconds / Playback.Speed of wall time.
    Advance(DeltaSeconds, Scene) {
        if (!this.Playing) return;
        const Loop = Scene.Playback.LoopSeconds;
        this.Seconds = (this.Seconds + DeltaSeconds * Scene.Playback.Speed) % Loop;
    }

    Seek(Seconds, Scene) {
        const Loop = Scene.Playback.LoopSeconds;
        this.Seconds = ((Seconds % Loop) + Loop) % Loop;
    }

    Toggle() {
        this.Playing = !this.Playing;
        return this.Playing;
    }
}
