package com.elfmcys.ysmvfx.compat.eyelib;

import com.elfmcys.ysmvfx.YesSteveVfx;
import com.elfmcys.ysmvfx.client.VfxClientRuntime;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Installs the eyelib renderer backend only in distributions that include eyelib. */
@Mod.EventBusSubscriber(modid = YesSteveVfx.MOD_ID, value = Dist.CLIENT,
        bus = Mod.EventBusSubscriber.Bus.MOD)
public final class EyelibBootstrap {
    private static final Logger LOGGER = LoggerFactory.getLogger(EyelibBootstrap.class);

    private EyelibBootstrap() {
    }

    @SubscribeEvent
    public static void setup(FMLClientSetupEvent event) {
        event.enqueueWork(() -> {
            try {
                VfxClientRuntime.installBackend(new EyelibBackend());
            } catch (LinkageError | RuntimeException exception) {
                // A bridge-built jar can still be placed in a profile without its
                // optional renderer dependency. Keep the core client usable there.
                LOGGER.warn("Could not install the optional eyelib VFX backend", exception);
            }
        });
    }
}
