package com.elfmcys.ysmvfx.api;

import com.elfmcys.ysmvfx.model.PortalDefinition;
import com.elfmcys.ysmvfx.server.ServerPortalManager;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;

/**
 * Optional direct integration point for other mods. Commands remain the
 * lowest-common-denominator interface; this avoids command-string parsing when
 * both mods are present in the same JVM.
 */
public final class VfxApi {
    private VfxApi() {
    }

    public static PortalDefinition permanentPortal(ServerLevel level, String id,
                                                   double x, double y, double z,
                                                   float radiusX, float radiusZ,
                                                   float virtualDepth) {
        return new PortalDefinition(
                id,
                level.dimension().location(),
                x, y, z,
                radiusX, radiusZ, virtualDepth,
                level.getGameTime(),
                -1
        );
    }

    public static void start(PortalDefinition definition) {
        ServerPortalManager.start(definition);
    }

    public static void stop(String id) {
        ServerPortalManager.stop(id);
    }

    public static void clear() {
        ServerPortalManager.clear();
    }
}
