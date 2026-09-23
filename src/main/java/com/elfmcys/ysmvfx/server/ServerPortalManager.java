package com.elfmcys.ysmvfx.server;

import com.elfmcys.ysmvfx.model.PortalDefinition;
import com.elfmcys.ysmvfx.network.VfxNetwork;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.event.server.ServerStoppedEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.server.ServerLifecycleHooks;

import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Server-side authoritative list used only to replicate visual effects. */
public final class ServerPortalManager {
    private static final Map<String, PortalDefinition> ACTIVE = new ConcurrentHashMap<>();

    private ServerPortalManager() {
    }

    public static void start(PortalDefinition definition) {
        ACTIVE.put(definition.id(), definition);
        VfxNetwork.broadcastStart(definition);
    }

    public static boolean stop(String id) {
        if (ACTIVE.remove(id) != null) {
            VfxNetwork.broadcastStop(id);
            return true;
        }
        return false;
    }

    public static void clear() {
        ACTIVE.clear();
        VfxNetwork.broadcastClear();
    }

    public static Collection<PortalDefinition> active() {
        return ACTIVE.values();
    }

    @SubscribeEvent
    public static void onPlayerLoggedIn(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            removeExpired(player.server);
            for (PortalDefinition definition : ACTIVE.values()) {
                VfxNetwork.sendStart(player, definition);
            }
        }
    }

    @SubscribeEvent
    public static void onServerTick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END) {
            return;
        }

        var server = ServerLifecycleHooks.getCurrentServer();
        if (server == null) {
            return;
        }

        removeExpired(server);
    }

    @SubscribeEvent
    public static void onServerStopped(ServerStoppedEvent event) {
        ACTIVE.clear();
    }

    private static void removeExpired(MinecraftServer server) {
        for (PortalDefinition definition : ACTIVE.values()) {
            if (definition.isPermanent()) {
                continue;
            }

            ResourceKey<Level> dimensionKey = ResourceKey.create(Registries.DIMENSION, definition.dimension());
            ServerLevel level = server.getLevel(dimensionKey);
            // Keep the entry while its dimension is unloaded. It is still
            // valid state and will be checked when that level is available.
            if (level != null && !definition.isAlive(level.getGameTime())
                    && ACTIVE.remove(definition.id(), definition)) {
                VfxNetwork.broadcastStop(definition.id());
            }
        }
    }
}
