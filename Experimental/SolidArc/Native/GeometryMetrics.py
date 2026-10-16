"""Exercise freshly compiled C++ geometry and vertex commands, not the retained CPU WASM reference."""
from pathlib import Path
import json
import subprocess
import unittest

Root = Path(__file__).resolve().parents[3]
subprocess.run(['python3', str(Path(__file__).with_name('CompileSequence.py')), '--native'], cwd=Root, check=True)


class GeometryMetrics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.Process = subprocess.Popen([str(Root / '_AgentScratch/build/SolidArcNative/GeometryHost')], cwd=Root,
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

    @classmethod
    def tearDownClass(cls):
        cls.Process.stdin.close()
        cls.Process.wait(timeout=10)
        cls.Process.stdout.close()

    def Exchange(self, Action='render', **Values):
        Request = dict(action=Action, identity=getattr(self, 'Identity', 0), width=800, height=600, **Values)
        self.Process.stdin.write(json.dumps(Request) + '\n')
        self.Process.stdin.flush()
        for Line in self.Process.stdout:
            if Line.startswith('SOLIDARC_PACKET '):
                Response = json.loads(Line[len('SOLIDARC_PACKET '):])
                self.assertNotIn('error', Response)
                return Response
        self.fail('Native command process exited before replying')

    def setUp(self):
        self.Identity = self.Exchange('create')['description']['identity']

    def Command(self, *Values):
        Response = self.Exchange('command', commands=Values)
        self.assertTrue(Response['success'], Values)
        return Response

    def test_modal_draw_is_atomic_and_undoable(self):
        Before = self.Exchange()['description']
        Failed = self.Exchange('command', commands=['draw rect (1,2)'])
        self.assertFalse(Failed['success'])
        self.assertEqual(Failed['description']['figures'], Before['figures'])
        After = self.Command('draw rect (1,2) (4,6)')['description']
        self.assertEqual(After['figures'][0]['low'], [1,2,0])
        self.assertEqual(After['figures'][0]['high'], [4,6,0])
        self.assertEqual(len(After['history']), 1)
        self.assertFalse(self.Command('undo')['description']['figures'])
        self.assertEqual(len(self.Command('redo')['description']['figures']), 1)

    def test_modal_shapes_and_workplanes(self):
        Cases = ['line (1,2) (3,4)', 'polyline (0,0) (1,0) (1,2) --closed',
                 'centerrect (2,2) (3,4)', 'circle (2,3) (4,3)', 'circle2 (1,2) (3,4)',
                 'arc (0,0) (1,0) (0,1)', 'ellipse (0,0) (2,0) (0,1)',
                 'slot (0,0) (2,0) (2,0.3)', 'polygon (0,0) (2,0) --sides=7',
                 'spline (0,0) (1,2) (3,1)', 'cpcurve (0,0) (1,2) (3,1)']
        for Case in Cases:
            with self.subTest(Case=Case):
                self.Command('reset')
                Result = self.Command('draw '+Case)
                self.assertEqual(len(Result['description']['figures']), 1)
                Saved = self.Exchange('save')['file']
                Reopened = self.Exchange('open', text=Saved)
                self.assertTrue(Reopened['success'])
                self.assertEqual(Reopened['description']['figures'], Result['description']['figures'])
        self.Command('reset', 'workplane xz --origin=(0,2,0)', 'draw circle (0,0) (1,0)')
        Figure = self.Exchange()['description']['figures'][0]
        self.assertAlmostEqual(Figure['low'][1], 2)
        self.assertAlmostEqual(Figure['high'][1], 2)

    def test_shape_kind_survives_rename_undo_and_reopen(self):
        Cases = [('circle3', '(1,0) (0,1) (-1,0)'), ('arc3', '(-1,0) (1,0) (0,1)'),
                 ('pslot', '(0,0) (2,0) (2,2) --radius=.3'),
                 ('sketch-point', '(1,2)'), ('datum-point', '(3,4)')]
        for Kind, Points in Cases:
            with self.subTest(kind=Kind):
                self.Command('reset')
                R = self.Command('draw '+Kind+' '+Points)
                F = R['description']['figures'][0]
                self.assertEqual(F['kind'], Kind)
                self.Command('rename '+str(F['id'])+' Renamed')
                self.assertEqual(self.Exchange()['description']['figures'][0]['kind'], Kind)
                Saved = self.Exchange('save')['file']
                Reopened = self.Exchange('open', text=Saved)
                self.assertTrue(Reopened['success'])
                self.assertEqual(Reopened['description']['figures'][0]['kind'], Kind)
                self.Command('undo')
                self.assertEqual(self.Exchange()['description']['figures'][0]['kind'], Kind)

    def test_background_snapshot_has_no_render_packet(self):
        self.Command('draw circle (1,2) (3,2)')
        Snapshot = self.Exchange('snapshot')
        self.assertTrue(Snapshot['success'])
        self.assertIn('draw circle', Snapshot['file'])
        self.assertNotIn('frame', Snapshot)
        self.assertNotIn('description', Snapshot)
        self.assertEqual(len(self.Exchange()['description']['figures']), 1)

    def test_native_tool_spatial_dimension_strokes(self):
        self.Command('tool rect', 'point (1,2)')
        Response = self.Command('pointer 480 360 --ctrl')
        self.assertEqual(Response['description']['figures'], [])
        self.assertTrue(any(Draw['kind']=='line' and Draw['positions'] for Draw in Response['frame']['draws']))
        self.Command('tool cancel')

    def test_command_frame_never_contains_cpu_pixels(self):
        Response = self.Command('box (0,0,0) 2 3 4 --name=Block', 'select Block', 'gizmo on')
        self.assertNotIn('pixels', Response)
        Frame = Response['frame']
        self.assertEqual(Frame['cpuFragments'], 0)
        self.assertEqual(Frame['rgbaUploads'], 0)
        self.assertEqual(set(Draw['kind'] for Draw in Frame['draws']), {'lattice', 'surface', 'line'})
        self.assertTrue(any(Draw['overlay'] for Draw in Frame['draws']))
        Figure = Response['description']['figures'][0]
        self.assertEqual((Figure['faces'], Figure['edges'], Figure['vertices']), (6, 12, 8))
        self.assertEqual(Figure['high'], [2, 3, 4])

    def test_every_original_example_executes_current_cpp(self):
        Script = "import {Examples} from './Experimental/SolidArc/src/CommandSpecification.js'; console.log(JSON.stringify(Examples));"
        Examples = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', Script], cwd=Root))
        for Name, Example in Examples.items():
            with self.subTest(Name=Name):
                Response = self.Command('reset', *Example['commands'])
                self.assertTrue(Response['description']['figures'])

    def test_all_twenty_seven_construct_entries(self):
        Script = "import {ConstructionCatalogue} from './Experimental/SolidArc/src/ConstructionSpecification.js'; console.log(JSON.stringify(ConstructionCatalogue.map((Entry,Index)=>[Entry.label,Entry.command(0,0)])));"
        Commands = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', Script], cwd=Root))
        self.assertEqual(len(Commands), 27)
        for Name, Command in Commands:
            with self.subTest(Name=Name):
                Response = self.Command('reset', Command)
                self.assertEqual(len(Response['description']['figures']), 1)

    def test_live_dimensions_undo_redo(self):
        Response = self.Command('box (0,0,0) 2 3 4 --name=Block', 'dim auto')
        Dimension = next(Item for Item in Response['description']['dimensions'] if Item['slot'] == 5)
        Response = self.Command(f"dim edit {Dimension['id']} 6")
        self.assertEqual(Response['description']['figures'][0]['high'][2], 6)
        self.assertEqual(self.Command('undo')['description']['figures'][0]['high'][2], 4)
        self.assertEqual(self.Command('redo')['description']['figures'][0]['high'][2], 6)

    def test_region_extrusion_preserves_hole(self):
        Response = self.Command('circle (0,0) 1 --name=Outer', 'circle (0,0) 0.4 --name=Inner')
        Region = next(Item for Item in Response['description']['areas'] if Item['holes'] == 1)
        Response = self.Command(f"extrude a{Region['id']} 1")
        Body = next(Item for Item in Response['description']['figures'] if Item['classification'] == 2)
        self.assertEqual(Body['faces'], 4)

    def test_native_save_open_and_malformed_input(self):
        Before = self.Command('box (0,0,0) 2 3 4 --name=Saved')['description']['figures']
        File = self.Exchange('save')['file']
        self.Command('reset')
        self.assertTrue(self.Exchange('open', text=File)['success'])
        self.assertEqual(self.Exchange()['description']['figures'], Before)
        Response = self.Exchange('open', text='not a native SolidArc document')
        self.assertFalse(Response['success'])
        self.assertEqual(Response['description']['figures'], Before)

    def test_independent_native_documents(self):
        First = self.Identity
        self.Command('box (0,0,0) 1 2 3 --name=First')
        self.Identity = self.Exchange('create')['description']['identity']
        self.Command('sphere (0,0,0) 1 --name=Second')
        self.assertEqual(self.Exchange()['description']['figures'][0]['name'], 'Second')
        self.Identity = First
        self.assertEqual(self.Exchange()['description']['figures'][0]['name'], 'First')

    def test_export_is_real_tessellated_obj(self):
        self.Command('box (0,0,0) 1 2 3')
        Response = self.Exchange('export')
        self.assertTrue(Response['success'])
        self.assertRegex(Response['file'], r'(?m)^v ')
        self.assertRegex(Response['file'], r'(?m)^f ')

    def test_orbit_changes_shared_camera_matrices(self):
        Before = self.Command('sphere (0,0,0) 1')['frame']['view']['ViewClip']
        After = self.Exchange('orbit', x=0.3, y=0.1)['frame']['view']['ViewClip']
        self.assertNotEqual(Before, After)

    def test_control_poles_have_gpu_point_commands(self):
        Response = self.Command('cpcurve (0,0) (1,2) (3,-1) (5,1) --name=Profile', 'select Profile', 'selectmode control', 'show cages on')
        Points = [Draw for Draw in Response['frame']['draws'] if Draw['kind'] == 'point']
        self.assertTrue(Points)
        Draw = next(Draw for Draw in Points if Draw['pick'])
        Response = self.Exchange('pick', x=10, y=20, intersection=Draw['pick'])
        self.assertEqual(len(Response['description']['figures'][0]['pickedPoles']), 1)

    def test_camera_synchronization_does_not_edit_geometry_or_undo(self):
        Before = self.Command('box (0,0,0) 1 2 3 --name=CameraProof')
        Camera = dict(Before['description']['camera'])
        Camera['yaw'] += 0.25
        Camera['pitch'] -= 0.1
        Camera['pivot'] = [2.0, 3.0, 1.0]
        After = self.Exchange('render', camera=Camera)
        self.assertEqual(After['description']['figures'], Before['description']['figures'])
        self.assertEqual(After['description']['history'], Before['description']['history'])
        self.assertAlmostEqual(After['description']['camera']['yaw'], Camera['yaw'], places=10)
        self.assertEqual(After['description']['camera']['pivot'], Camera['pivot'])
        self.assertNotEqual(After['frame']['view']['ViewClip'], Before['frame']['view']['ViewClip'])

    def test_refused_geometry_preserves_scene(self):
        Before = self.Command('sphere (0,0,0) 1 --name=Ball')['description']['figures']
        Response = self.Exchange('command', commands=['shell Ball 0.1 --face=999'])
        self.assertFalse(Response['success'])
        self.assertEqual(Response['description']['figures'], Before)

    def test_synthetic_identity_runs_drive_box_selection(self):
        Response = self.Command('box (-3,0,0) 1 1 1 --name=Left', 'box (2,0,0) 1 1 1 --name=Right', 'gizmo off')
        Left, Right = Response['description']['figures']
        Runs = f"800\n8010 10 {Left['id']}\n8420 10 {Right['id']}"
        Response = self.Exchange('command', commands=['select box 0 0 100 100'], intersectionRuns=Runs)
        self.assertEqual([Item['name'] for Item in Response['description']['figures'] if Item['selected']], ['Left'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
