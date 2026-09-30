package com.elfmcys.ysmvfx.compat.yss;

import com.elfmcys.ysmvfx.network.VfxNetwork;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.eventbus.api.EventPriority;
import net.minecraftforge.eventbus.api.Event;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.lang.reflect.Method;
import java.util.function.Consumer;

/** Reflection-only YSS bridge; VFX remains loadable without YSS installed. */
public final class YssHitBridge {
    private static final Logger LOGGER = LoggerFactory.getLogger("yesstevevfx/YSS");
    private static final String EVENT = "io.github.tt432.yessteveskill.event.YssHitResolvedEvent";
    private static Method attackerMethod, targetMethod, modelMethod, animationMethod, segmentMethod, positionMethod;
    private static boolean enabled;

    private YssHitBridge() { }

    public static void install() {
        try {
            if (enabled) return;
            Class<? extends Event> eventType = Class.forName(EVENT).asSubclass(Event.class);
            attackerMethod = eventType.getMethod("attacker");
            targetMethod = eventType.getMethod("target");
            modelMethod = eventType.getMethod("modelId");
            animationMethod = eventType.getMethod("animation");
            segmentMethod = eventType.getMethod("segmentIndex");
            positionMethod = eventType.getMethod("position");
            register(eventType);
            enabled = true;
            LOGGER.info("YSS hit sound bridge enabled");
        } catch (ClassNotFoundException ignored) {
            LOGGER.debug("YSS not installed; hit sound bridge disabled");
        } catch (ReflectiveOperationException | RuntimeException | LinkageError error) {
            LOGGER.warn("Could not install optional YSS hit bridge", error);
        }
    }

    private static <T extends Event> void register(Class<T> eventType) {
        MinecraftForge.EVENT_BUS.addListener(EventPriority.NORMAL, false, eventType,
                YssHitBridge::onHit);
    }

    private static void onHit(Object event) {
        if (!enabled) return;
        try {
            ServerPlayer attacker = (ServerPlayer) attackerMethod.invoke(event);
            LivingEntity target = (LivingEntity) targetMethod.invoke(event);
            if (attacker == null || target == null || !(target.level() instanceof ServerLevel level)) return;
            String modelId = (String) modelMethod.invoke(event);
            String animation = (String) animationMethod.invoke(event);
            int segment = ((Number) segmentMethod.invoke(event)).intValue();
            Vec3 position = (Vec3) positionMethod.invoke(event);
            if (modelId == null || animation == null || position == null) return;
            VfxNetwork.sendHit(level, attacker, modelId, animation, segment, position, target.getUUID());
        } catch (ReflectiveOperationException | RuntimeException | LinkageError error) {
            enabled = false;
            LOGGER.warn("Disabling incompatible YSS hit bridge", error);
        }
    }
}
