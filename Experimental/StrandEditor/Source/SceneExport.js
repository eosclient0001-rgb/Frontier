//============================================================================================================================================
//                                                               SCENEEXPORT.JS
//============================================================================================================================================
// 📦 Downloads for PNG frames, scene JSON and a real-time WebM recording of one loop from the output canvas.

export function DownloadBlob(Blob, FileName) {
    const Url = URL.createObjectURL(Blob);
    const Link = document.createElement('a');
    Link.href = Url;
    Link.download = FileName;
    document.body.appendChild(Link);
    Link.click();
    setTimeout(() => {
        URL.revokeObjectURL(Url);
        Link.remove();
    }, 1000);
}

export function DownloadText(Text, FileName) {
    DownloadBlob(new Blob([Text], { type: 'application/json' }), FileName);
}

export function CanvasToPng(Canvas) {
    return new Promise((Resolve, Reject) => {
        Canvas.toBlob((Blob) => (Blob ? Resolve(Blob) : Reject(new Error('PNG encoding failed'))), 'image/png');
    });
}

// 📝 Records in real time: the timeline keeps running while MediaRecorder samples the canvas, so the file is one loop.
export function RecordLoop(Canvas, Seconds, Fps = 60) {
    return new Promise((Resolve, Reject) => {
        if (typeof Canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
            Reject(new Error('This browser cannot record canvas video.'));
            return;
        }
        const Candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
        const MimeType = Candidates.find((Type) => MediaRecorder.isTypeSupported(Type)) || '';
        const Recorder = new MediaRecorder(Canvas.captureStream(Fps), MimeType ? { mimeType: MimeType, videoBitsPerSecond: 12000000 } : undefined);
        const Parts = [];
        Recorder.ondataavailable = (Incoming) => {
            if (Incoming.data && Incoming.data.size > 0) Parts.push(Incoming.data);
        };
        Recorder.onstop = () => Resolve(new Blob(Parts, { type: 'video/webm' }));
        Recorder.onerror = (Incoming) => Reject(Incoming.error || new Error('Recording failed'));
        Recorder.start(250);
        setTimeout(() => Recorder.stop(), Seconds * 1000);
    });
}
