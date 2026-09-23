package com.elfmcys.ysmvfx.compat.ysm;

import com.elfmcys.ysm.api.annotation.Side;
import com.elfmcys.ysm.api.annotation.YsmExtension;
import com.elfmcys.ysm.client.animation.molang.CtrlBinding;
import com.elfmcys.ysm.client.entity.IPreviewEntity;
import com.elfmcys.ysm.geckolib3.core.molang.context.IContext;
import com.elfmcys.ysm.molang.runtime.ExecutionContext;
import com.elfmcys.ysm.molang.runtime.Function;
import com.elfmcys.ysmvfx.api.VfxApi;
import net.minecraft.world.entity.Entity;
import org.apache.commons.lang3.concurrent.ConcurrentException;

import java.util.UUID;

/** Optional, version-checked YSM control bridge; no YSM rendering is used by VFX. */
public final class YsmIntegration {
    private static boolean installed;

    private YsmIntegration() {
    }

    /**
     * Invoke on the client setup thread, before YSM parses model animations.
     * The caller must first run YsmIntegrationCompatibilityChecker.checkInstall().
     */
    @YsmExtension(side = Side.CLIENT)
    public static synchronized void install() {
        if (installed) {
            return;
        }

        final CtrlBinding binding;
        try {
            binding = CtrlBinding.INSTANCE.get();
        } catch (ConcurrentException exception) {
            throw new IllegalStateException("Could not initialize the YSM control binding", exception);
        }

        // Never overwrite another extension or a future built-in implementation.
        for (String name : new String[]{"vfx_play", "vfx_stop", "vfx_set"}) {
            if (binding.getProperty(name) != null) {
                throw new IllegalStateException("YSM control function already registered: ctrl." + name);
            }
        }

        binding.function("vfx_play", fixedArity(YsmIntegration::play, 2));
        binding.function("vfx_stop", fixedArity(YsmIntegration::stop, 1));
        binding.function("vfx_set", fixedArity(YsmIntegration::set, 3));
        installed = true;
    }

    private static Object play(ExecutionContext<?> execution, Function.ArgumentCollection arguments) {
        UUID source = actionSource(execution, arguments, 2);
        if (source == null) {
            return 0F;
        }
        String effect = arguments.getAsString(execution, 0);
        String slot = arguments.getAsString(execution, 1);
        return effect != null && slot != null && VfxApi.play(source, effect, slot) ? 1F : 0F;
    }

    private static Object stop(ExecutionContext<?> execution, Function.ArgumentCollection arguments) {
        UUID source = actionSource(execution, arguments, 1);
        if (source == null) {
            return 0F;
        }
        String slot = arguments.getAsString(execution, 0);
        return slot != null && VfxApi.stop(source, slot) ? 1F : 0F;
    }

    private static Object set(ExecutionContext<?> execution, Function.ArgumentCollection arguments) {
        UUID source = actionSource(execution, arguments, 3);
        if (source == null) {
            return 0F;
        }
        String slot = arguments.getAsString(execution, 0);
        String name = arguments.getAsString(execution, 1);
        double value = arguments.getAsDouble(execution, 2);
        return slot != null && name != null && Double.isFinite(value)
                && VfxApi.set(source, slot, name, value) ? 1F : 0F;
    }

    private static Function fixedArity(Function delegate, int arity) {
        return new Function() {
            @Override
            public Object evaluate(ExecutionContext<?> execution, Function.ArgumentCollection arguments) {
                return delegate.evaluate(execution, arguments);
            }

            @Override
            public boolean validateArgumentSize(int size) {
                return size == arity;
            }
        };
    }

    private static UUID actionSource(ExecutionContext<?> execution,
                                     Function.ArgumentCollection arguments, int arity) {
        if (arguments.size() != arity || !(execution.entity() instanceof IContext<?> context)
                || !context.allowEmitting() || !(context.entity() instanceof Entity entity)
                || entity.isRemoved() || !entity.level().isClientSide) {
            return null;
        }
        var animatable = context.animatableEntity();
        if (animatable == null || animatable.isFakePlayer() || animatable instanceof IPreviewEntity) {
            return null;
        }
        // Keep no Entity, Molang context, argument view or AST alive after this invocation.
        return entity.getUUID();
    }
}
