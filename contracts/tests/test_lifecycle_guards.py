"""Adversarial lifecycle tests for the GenLayer Intelligent Contract.

Run with the GenLayer direct-mode test package installed:
    pytest contracts/tests/test_lifecycle_guards.py
"""
from pathlib import Path

import pytest

genlayer_test = pytest.importorskip("gltest.direct")
VMContext = genlayer_test.VMContext
deploy_contract = genlayer_test.deploy_contract
create_address = genlayer_test.create_address

CONTRACT = Path(__file__).parents[1] / "meme_olympics.py"
OWNER = create_address("owner")
AUTHOR = create_address("author")
START = "2030-01-01T00:00:00+00:00"
END = "2030-01-02T00:00:00+00:00"


@pytest.fixture()
def arena():
    vm = VMContext()
    vm.sender = OWNER
    vm.warp(START)
    with vm.activate():
        contract = deploy_contract(CONTRACT, vm, "0x" + OWNER.hex())
        contract.create_competition("arena-guard", "Guard arena", "tests", START, END, 0)
        contract.open_competition("arena-guard")
        with vm.prank(AUTHOR):
            contract.submit_meme(
                "arena-guard", "entry-guard", "A real meme", "caption",
                "https://example.com/meme.png", "", "[]", START,
            )
        yield vm, contract


def test_rejects_premature_closure(arena):
    vm, contract = arena
    with vm.expect_revert("Competition deadline has not passed"):
        contract.close_submissions("arena-guard")


def test_rejects_evaluation_while_open(arena):
    vm, contract = arena
    with vm.expect_revert("cannot evaluate"):
        contract.evaluate_submission("entry-guard")


def test_rejects_finalization_with_pending_submission(arena):
    vm, contract = arena
    vm.warp("2030-01-02T00:00:01+00:00")
    contract.close_submissions("arena-guard")
    with vm.expect_revert("judging incomplete"):
        contract.finalize_competition("arena-guard", "caller-controlled-time-is-ignored")


def test_terminal_invalid_image_recovery_allows_finalization(arena):
    vm, contract = arena
    vm.warp("2030-01-02T00:00:01+00:00")
    contract.close_submissions("arena-guard")

    first = "0x" + "11" * 32
    second = "0x" + "22" * 32
    third = "0x" + "33" * 32
    contract.record_unjudgeable_attempt("entry-guard", first)
    with vm.expect_revert("Three failed evaluation commitments are required"):
        contract.disqualify_unjudgeable_submission("entry-guard", "too early")
    with vm.expect_revert("Evidence transaction already recorded"):
        contract.record_unjudgeable_attempt("entry-guard", first)
    contract.record_unjudgeable_attempt("entry-guard", second)
    contract.record_unjudgeable_attempt("entry-guard", third)
    contract.disqualify_unjudgeable_submission(
        "entry-guard", "Repeated INVALID_IMAGE after three validator attempts"
    )

    submission = contract.get_submission("entry-guard")
    assert submission["status"] == "disqualified"
    assert "INVALID_IMAGE" in submission["evaluation_summary"]
    assert submission["unjudgeable_attempt_count"] == 3
    assert submission["unjudgeable_attempt_tx_hashes"] == [first, second, third]

    contract.finalize_competition("arena-guard", "ignored")
    assert contract.get_competition("arena-guard")["status"] == "finalized"
