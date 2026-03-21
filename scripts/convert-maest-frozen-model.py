#!/usr/bin/env python3

"""Convert a MAEST frozen graph to a TensorFlow.js graph model.

This avoids tensorflowjs' top-level converter entrypoint because that eagerly
imports tensorflow_decision_forests for SavedModel support. Recent ydf builds
can raise a protobuf runtime-version error during that import, even though
frozen-graph conversion does not need TF-DF at all.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import tempfile
import textwrap
import types


def create_tensorflowjs_shims() -> pathlib.Path:
    spec = importlib.util.find_spec("tensorflowjs")
    if spec is None or not spec.submodule_search_locations:
        raise RuntimeError(
            "Could not find the tensorflowjs package. Run `npm run setup:python-ml` first."
        )

    real_package_dir = pathlib.Path(list(spec.submodule_search_locations)[0]).resolve()
    real_converters_dir = real_package_dir / "converters"

    shim_root = pathlib.Path(tempfile.mkdtemp(prefix="gma3-tfjs-shim-"))
    shim_package_dir = shim_root / "tensorflowjs"
    shim_converters_dir = shim_package_dir / "converters"
    shim_converters_dir.mkdir(parents=True, exist_ok=True)

    shim_package_dir.joinpath("__init__.py").write_text(
        textwrap.dedent(
            f"""
            import pathlib

            __path__ = [
                str(pathlib.Path(__file__).resolve().parent),
                {str(real_package_dir)!r},
            ]
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )

    shim_converters_dir.joinpath("__init__.py").write_text(
        textwrap.dedent(
            f"""
            import pathlib

            __path__ = [
                str(pathlib.Path(__file__).resolve().parent),
                {str(real_converters_dir)!r},
            ]
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )

    return shim_root


def main() -> int:
    if len(sys.argv) != 5:
        print(
            "Usage: convert-maest-frozen-model.py <frozen.pb> <output-node-names> <output-dir> <metadata-json>",
            file=sys.stderr,
        )
        return 1

    _, frozen_model_path, output_node_names, output_dir, metadata_json = sys.argv

    shim_root = create_tensorflowjs_shims()
    sys.path.insert(0, str(shim_root))

    # Frozen-graph conversion does not need TF-DF, but tensorflowjs imports the
    # SavedModel converter module that imports tensorflow_decision_forests at
    # module load time. Provide a minimal stub to bypass that optional import.
    sys.modules.setdefault("tensorflow_decision_forests", types.ModuleType("tensorflow_decision_forests"))

    try:
        from tensorflowjs.converters import tf_saved_model_conversion_v2
    except ModuleNotFoundError as error:
        if error.name == "pkg_resources":
            raise RuntimeError(
                "The selected Python environment is missing setuptools/pkg_resources. "
                "Recent setuptools releases can omit pkg_resources, so rerun "
                "`npm run setup:python-ml` or install a compatible setuptools build with "
                "`python -m pip install --upgrade 'setuptools>=70,<81'`."
            ) from error
        raise

    tf_saved_model_conversion_v2.convert_tf_frozen_model(
        frozen_model_path=frozen_model_path,
        output_node_names=output_node_names,
        output_dir=output_dir,
        metadata=json.loads(metadata_json),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
