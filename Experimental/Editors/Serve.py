from http.server import SimpleHTTPRequestHandler as StaticRequestBase, ThreadingHTTPServer
from pathlib import Path
import os


RepositoryRoot = Path(__file__).resolve().parents[2]
EditorPortal = Path('Experimental/Editors/index.html')
Port = int(os.environ.get('PORT', '5173'))


class EditorRequestHandler(StaticRequestBase):
    def __init__(Self, *Arguments, **Options):
        super().__init__(*Arguments, directory=str(RepositoryRoot), **Options)

    def translate_path(Self, RequestPath):
        if RequestPath in ('/', '/index.html'):
            return str(RepositoryRoot / EditorPortal)
        return super().translate_path(RequestPath)


def RunServer():
    HTTPListener = ThreadingHTTPServer(('0.0.0.0', Port), EditorRequestHandler)
    print(f'Frontier Experimental Editors listening on http://0.0.0.0:{Port}/')
    HTTPListener.serve_forever()


if __name__ == '__main__':
    RunServer()
