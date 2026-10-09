package com.elfmcys.ysmvfx.api;

import net.minecraft.world.phys.AABB;

import java.util.Objects;

/** A read-only world-space collision box exported by an active VFX model. */
public record VfxHitBox(String effectId, String slot, AABB box) {
    public VfxHitBox {
        Objects.requireNonNull(effectId, "effectId");
        Objects.requireNonNull(slot, "slot");
        Objects.requireNonNull(box, "box");
    }
}
