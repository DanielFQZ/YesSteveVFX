package com.elfmcys.ysmvfx.model;

import net.minecraft.resources.ResourceLocation;

/** Immutable description of one visual portal. */
public record PortalDefinition(
        String id,
        ResourceLocation dimension,
        double x,
        double y,
        double z,
        float radiusX,
        float radiusZ,
        float virtualDepth,
        long startGameTime,
        int duration
) {
    public PortalDefinition {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("Portal id must not be blank");
        }
        if (dimension == null) {
            throw new IllegalArgumentException("Portal dimension must not be null");
        }
        if (radiusX <= 0.0f || radiusZ <= 0.0f) {
            throw new IllegalArgumentException("Portal radii must be positive");
        }
        if (virtualDepth < 0.0f) {
            throw new IllegalArgumentException("Portal virtual depth must not be negative");
        }
    }

    public boolean isPermanent() {
        return duration < 0;
    }

    public boolean isAlive(long gameTime) {
        return isPermanent() || gameTime - startGameTime < duration;
    }
}
