package com.elfmcys.ysmvfx.audio;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.sounds.AbstractTickableSoundInstance;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.*;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import org.jetbrains.annotations.Nullable;

final class MinecraftAudioBackend implements AudioBackend {
    @Override public Handle play(SoundDefinition definition,ResourceLocation event,Entity entity) {
        Voice voice=new Voice(definition,event,entity.position(),entity);
        Minecraft.getInstance().getSoundManager().play(voice); return voice;
    }
    @Override public Handle play(SoundDefinition definition, ResourceLocation event, Vec3 position,
                                 @Nullable Entity following) {
        Voice voice=new Voice(definition,event,position,following);
        Minecraft.getInstance().getSoundManager().play(voice); return voice;
    }
    @Override public void stop(Handle handle){
        Voice v=(Voice)handle; v.finish(); Minecraft.getInstance().getSoundManager().stop(v);
    }
    @Override public boolean active(Handle handle){
        Voice v=(Voice)handle;
        return !v.isStopped() && Minecraft.getInstance().getSoundManager().isActive(v);
    }
    private static final class Voice extends AbstractTickableSoundInstance implements Handle {
        private final Entity following;
        private final Vec3 offset;
        Voice(SoundDefinition d,ResourceLocation id,Vec3 position,@Nullable Entity owner) {
            super(SoundEvent.createVariableRangeEvent(id),SoundSource.PLAYERS,RandomSource.create());
            volume=d.volume();pitch=d.pitch();looping=false;relative=false;
            x=position.x;y=position.y;z=position.z; following=d.follow()?owner:null;
            offset=following==null?Vec3.ZERO:position.subtract(following.position());
        }
        @Override public void tick(){
            if(following!=null) {
                if(following.isRemoved() || following.level()!=Minecraft.getInstance().level) {stop();return;}
                x=following.getX()+offset.x;y=following.getY()+offset.y;z=following.getZ()+offset.z;
            }
        }
        void finish(){stop();}
    }
}
