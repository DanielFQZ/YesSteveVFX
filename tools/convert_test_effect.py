from pathlib import Path
import json
import shutil


SOURCE = Path(r"E:\JavaProject\YesSteveModel\测试特效")
OUTPUT = Path(r"E:\JavaProject\YesSteveModel\YesSteveVFX\examples\test_effect")


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    (OUTPUT / "effects").mkdir(parents=True)
    (OUTPUT / "assets/eyelib/entity").mkdir(parents=True)
    (OUTPUT / "assets/eyelib/models").mkdir(parents=True)
    (OUTPUT / "assets/eyelib/animations").mkdir(parents=True)
    (OUTPUT / "assets/eyelib/particles").mkdir(parents=True)
    (OUTPUT / "assets/eyelib/render_controllers").mkdir(parents=True)
    (OUTPUT / "assets/eyelib/textures").mkdir(parents=True)

    animations = json.loads((SOURCE / "test.animation.json").read_text(encoding="utf-8"))
    converted = {}
    effect_names = {"12": "particle1", "2": "particle2", "3": "particle3", "particletest3": "particle3"}
    for name in ("test1", "test2", "test3", "test4", "test5"):
        animation = animations["animations"][name]
        for event in (animation.get("particle_effects") or {}).values():
            if isinstance(event, dict) and isinstance(event.get("effect"), str):
                event["effect"] = effect_names.get(event["effect"], event["effect"])
        converted[f"animation.yesstevevfx.{name}"] = animation
    animations["animations"] = converted
    write_json(OUTPUT / "assets/eyelib/animations/test.animation.json", animations)

    geometry = json.loads((SOURCE / "test.geo.json").read_text(encoding="utf-8"))
    for entry in geometry.get("minecraft:geometry", []):
        entry.setdefault("description", {})["identifier"] = "geometry.yesstevevfx.test"
    write_json(OUTPUT / "assets/eyelib/models/test.geo.json", geometry)

    for index in (1, 2, 3):
        particle = json.loads((SOURCE / f"particletest{index}.json").read_text(encoding="utf-8"))
        description = particle["particle_effect"]["description"]
        description["identifier"] = f"yesstevevfx:test/particle{index}"
        description["basic_render_parameters"]["texture"] = "yesstevevfx:textures/particle"
        write_json(OUTPUT / f"assets/eyelib/particles/particle{index}.json", particle)

    for name in ("test1", "test2", "test3", "test4", "test5"):
        entity = {
            "minecraft:client_entity": {
                "description": {
                    "identifier": f"yesstevevfx:{name}",
                    "materials": {"default": "entity_alphatest"},
                    "textures": {"default": "yesstevevfx:textures/test"},
                    "geometry": {"default": "geometry.yesstevevfx.test"},
                    "animations": {"test": f"animation.yesstevevfx.{name}"},
                    "particle_effects": {
                        "particle1": "yesstevevfx:test/particle1",
                        "particle2": "yesstevevfx:test/particle2",
                        "particle3": "yesstevevfx:test/particle3",
                    },
                    "render_controllers": ["controller.render.yesstevevfx.test"],
                    "scripts": {"animate": ["test"]},
                }
            }
        }
        write_json(OUTPUT / f"assets/eyelib/entity/{name}.json", entity)

    render = {
        "format_version": "1.8.0",
        "render_controllers": {
            "controller.render.yesstevevfx.test": {
                "geometry": "Geometry.default",
                "materials": [{"default": "Material.default"}],
                "textures": ["Texture.default"],
            }
        },
    }
    write_json(OUTPUT / "assets/eyelib/render_controllers/test.json", render)

    names = ("test1", "test2", "test3", "test4", "test5")
    write_json(
        OUTPUT / "manifest.json",
        {
            "format_version": 1,
            "pack_id": "test_effect",
            "display_name": "YesSteveVFX supplied test effects",
            "effects": [f"effects/{name}.json" for name in names],
        },
    )
    for name in names:
        write_json(
            OUTPUT / f"effects/{name}.json",
            {
                "format_version": 1,
                "id": f"yesstevevfx:{name}",
                "duration_ticks": 100,
                "client_entity": f"assets/eyelib/entity/{name}.json",
            },
        )

    shutil.copy2(SOURCE / "test.swing.texture.png", OUTPUT / "assets/eyelib/textures/test.png")
    shutil.copy2(SOURCE / "test.particle.texture.png", OUTPUT / "assets/eyelib/textures/particle.png")
    (OUTPUT / "README.md").write_text(
        """# Supplied test effects

After restarting the client, run `/vfx_client reload`, then play `yesstevevfx:test1` through `yesstevevfx:test5` in slots with the same names.

`test1`–`test3` combine model animation and particles; `test4` is model-only; `test5` is a looping particle-only effect.
""",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
