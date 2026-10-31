"""Static safety invariants for nested GenLayer validator functions."""
import ast
from pathlib import Path


SOURCE = Path(__file__).parents[1] / "meme_olympics.py"
TREE = ast.parse(SOURCE.read_text())


def _functions(name: str):
    return [node for node in ast.walk(TREE) if isinstance(node, ast.FunctionDef) and node.name == name]


def test_transient_leader_errors_are_never_accepted_as_agreement():
    handlers = _functions("_handle_leader_error")
    assert len(handlers) == 1
    implementation = ast.unparse(handlers[0])
    assert "ERROR_TRANSIENT" not in implementation


def test_successful_leader_requires_completed_validator_execution():
    validators = _functions("validator_fn")
    assert len(validators) == 2  # evaluation and dispute resolution
    for validator in validators:
        user_error_handlers = [
            node for node in ast.walk(validator)
            if isinstance(node, ast.ExceptHandler)
            and node.type is not None
            and "UserError" in ast.unparse(node.type)
        ]
        assert len(user_error_handlers) == 1
        returns = [
            node for node in ast.walk(user_error_handlers[0])
            if isinstance(node, ast.Return)
        ]
        assert returns
        assert all(isinstance(node.value, ast.Constant) and node.value.value is False for node in returns)
