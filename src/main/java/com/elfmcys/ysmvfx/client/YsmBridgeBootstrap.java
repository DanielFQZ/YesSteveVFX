package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.YesSteveVfx;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.lang.reflect.InvocationTargetException;

/** Loads the optional YSM bridge without linking YSM classes in the core jar. */
public final class YsmBridgeBootstrap {
    private static final Logger LOGGER = LoggerFactory.getLogger(YesSteveVfx.MOD_ID + ".ysm");
    private static boolean attempted;

    private YsmBridgeBootstrap() {
    }

    public static synchronized void tryInstall() {
        if (attempted) {
            return;
        }
        attempted = true;
        try {
            ClassLoader loader = YsmBridgeBootstrap.class.getClassLoader();
            Class<?> checker = Class.forName(
                    "com.elfmcys.ysmvfx.compat.ysm.YsmIntegrationCompatibilityChecker", false, loader);
            Object result = checker.getMethod("checkInstall").invoke(null);
            boolean compatible = (Boolean) result.getClass().getMethod("isCompatible").invoke(result);
            boolean complete = (Boolean) result.getClass().getMethod("coverageComplete").invoke(result);
            if (!compatible || !complete) {
                LOGGER.warn("YSM bridge compatibility check failed; Molang VFX functions are disabled: {}", result);
                return;
            }
            Class<?> integration = Class.forName(
                    "com.elfmcys.ysmvfx.compat.ysm.YsmIntegration", true, loader);
            integration.getMethod("install").invoke(null);
            LOGGER.info("Installed the optional YSM ctrl.vfx_* bridge");
        } catch (ClassNotFoundException ignored) {
            // YSM or the optional bridge source set is absent.
        } catch (InvocationTargetException exception) {
            LOGGER.warn("Could not install the optional YSM VFX bridge", exception.getCause());
        } catch (ReflectiveOperationException | LinkageError | RuntimeException exception) {
            LOGGER.warn("Could not inspect the optional YSM VFX bridge", exception);
        }
    }
}
