package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.model.PortalDefinition;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.resources.ResourceLocation;

import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Client-side render snapshot. All writes are scheduled on the render thread. */
public final class ClientPortalManager {
    private static final Map<String, PortalDefinition> ACTIVE = new ConcurrentHashMap<>();

    private ClientPortalManager() {
    }

    public static void start(PortalDefinition definition) {
        ACTIVE.put(definition.id(), definition);
    }

    public static void stop(String id) {
        ACTIVE.remove(id);
    }

    public static void clear() {
        ACTIVE.clear();
    }

    public static Collection<PortalDefinition> visibleIn(ClientLevel level) {
        ResourceLocation dimension = level.dimension().location();
        long gameTime = level.getGameTime();
        ACTIVE.values().removeIf(definition -> !definition.isAlive(gameTime));
        return ACTIVE.values().stream()
                .filter(definition -> definition.dimension().equals(dimension))
                .toList();
    }
}
