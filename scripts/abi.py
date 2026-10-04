"""Copies the contract ABIs from Foundry's build output into web/lib/abi.ts."""
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
abi = json.loads((root / "contracts/out/Till.sol/Till.json").read_text())["abi"]
fwd = json.loads((root / "contracts/out/ERC2771Forwarder.sol/ERC2771Forwarder.json").read_text())["abi"]
fwd = [x for x in fwd if x.get("name") in ("execute", "verify", "nonces", "eip712Domain") or x["type"] == "error"]
(root / "web/lib/abi.ts").write_text(
    "// Generated from contracts/out by scripts/abi.py. Do not edit by hand.\n"
    f"export const tillAbi = {json.dumps(abi)} as const;\n\n"
    f"export const forwarderAbi = {json.dumps(fwd)} as const;\n"
)
