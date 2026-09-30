package com.elfmcys.ysmvfx.audio;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import net.minecraft.resources.ResourceLocation;
import org.jetbrains.annotations.Nullable;
public interface AudioBackend {
    interface Handle { }
    Handle play(SoundDefinition definition, ResourceLocation event, Entity source);
    Handle play(SoundDefinition definition, ResourceLocation event, Vec3 position,
                @Nullable Entity following);
    void stop(Handle handle);
    boolean active(Handle handle);
}
