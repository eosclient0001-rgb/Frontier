from pathlib import Path
import runpy


SharedServer = Path(__file__).resolve().parents[1] / 'Serve.py'
runpy.run_path(str(SharedServer), run_name='__main__')
