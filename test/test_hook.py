"""Pruebas del hook (assets/hook.py) con la biblioteca estándar."""

import importlib.util
import io
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hook', os.path.join(HERE, '..', 'assets', 'hook.py'))
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)


class TestTrim(unittest.TestCase):
    def test_textos_largos(self):
        out = hook.trim('x' * 5000)
        self.assertEqual(len(out), hook.MAX_STR + 1)
        self.assertTrue(out.endswith('…'))

    def test_estructuras(self):
        deep = {'a': {'b': {'c': {'d': {'e': {'f': 1}}}}}}
        self.assertEqual(hook.trim(deep), {'a': {'b': {'c': {'d': {'e': None}}}}})
        self.assertEqual(len(hook.trim(list(range(100)))), hook.MAX_ITEMS)
        self.assertIsNone(hook.trim(object()))


class TestPick(unittest.TestCase):
    def test_descarta_campos_privados(self):
        ev = hook.pick({
            'session_id': 's', 'hook_event_name': 'UserPromptSubmit', 'prompt': 'secreto',
            'transcript_path': '/t', 'cwd': '/p',
        })
        self.assertEqual(ev, {'session_id': 's', 'hook_event_name': 'UserPromptSubmit', 'cwd': '/p'})


class TestOutput(unittest.TestCase):
    def test_allow_deny(self):
        allow = hook.output_for({'decision': 'allow'})
        self.assertEqual(allow['hookSpecificOutput']['decision'], {'behavior': 'allow'})
        deny = hook.output_for({'decision': 'deny'})
        self.assertEqual(deny['hookSpecificOutput']['decision']['behavior'], 'deny')
        self.assertEqual(deny['hookSpecificOutput']['hookEventName'], 'PermissionRequest')

    def test_nunca_decide_por_omision(self):
        for reply in (None, {}, {'decision': 'none'}, {'decision': 'ALLOW'}, [], 'allow'):
            self.assertIsNone(hook.output_for(reply))


class TestSocketPath(unittest.TestCase):
    def test_orden(self):
        self.assertEqual(hook.socket_path({'HOSHII_SOCKET': '/x.sock'}), '/x.sock')
        self.assertEqual(hook.socket_path({'XDG_RUNTIME_DIR': '/run/user/7'}), '/run/user/7/hoshii/hoshii.sock')


class TestMain(unittest.TestCase):
    def run_main(self, text):
        out = io.StringIO()
        code = hook.main(io.StringIO(text), out, {'HOSHII_SOCKET': '/tmp/hoshii-no-existe.sock'})
        return code, out.getvalue()

    def test_sin_app_no_imprime(self):
        ev = json.dumps({'session_id': 's', 'hook_event_name': 'PermissionRequest', 'tool_name': 'Bash'})
        self.assertEqual(self.run_main(ev), (0, ''))

    def test_entrada_basura(self):
        for text in ('', 'no json', '[]', '{"hook_event_name": 1}'):
            self.assertEqual(self.run_main(text), (0, ''))


if __name__ == '__main__':
    unittest.main()
