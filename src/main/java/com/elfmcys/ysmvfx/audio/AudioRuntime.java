package com.elfmcys.ysmvfx.audio;

import java.util.*;
import java.util.concurrent.*;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import net.minecraft.server.packs.resources.PreparableReloadListener;
import net.minecraft.util.profiling.InactiveProfiler;
import com.elfmcys.ysmvfx.client.VfxClientRuntime;

public final class AudioRuntime {
    private static final AudioBackend BACKEND=new MinecraftAudioBackend();
    private static final AudioActionQueue QUEUE=new AudioActionQueue();
    private static final Map<Key,AudioBackend.Handle> ACTIVE=new LinkedHashMap<>();
    private static volatile AudioCatalog catalog=AudioCatalog.EMPTY;
    private static volatile boolean ready;
    /** A voice gets its own identity; the slot is a stop-group, not a replacement key. */
    private record Key(UUID owner,String slot,long voiceId) { }
    private static long nextVoiceId;
    private AudioRuntime(){ }
    public static AudioCatalog catalog(){return catalog;}
    public static void loading(){ready=false;clear();}
    public static void publish(AudioCatalog value){catalog=value;QUEUE.invalidate();ready=true;}
    public static boolean play(UUID owner,String id,String slot){
        long session=QUEUE.session();
        return ready && id!=null && catalog.sounds().containsKey(id) && QUEUE.offer(owner,slot,id,session);
    }
    public static boolean stop(UUID owner,String slot){
        long session=QUEUE.session();return ready && QUEUE.offer(owner,slot,null,session);
    }
    /** Plays a server-confirmed hit binding at a captured position. */
    public static boolean playHit(UUID owner, String modelId, String animation, int segmentIndex,
                                  Vec3 position, Entity target, long sequence) {
        if (!ready || owner == null || position == null) return false;
        String id = catalog.hits().get(new AudioCatalog.HitKey(modelId, animation, segmentIndex));
        return id != null && playHitSound(owner, id, position, target, sequence);
    }

    public static boolean playHitSound(UUID owner, String id, Vec3 position, Entity target, long sequence) {
        if (!ready || owner == null || id == null || position == null) return false;
        var sound = catalog.sounds().get(id);
        var event = VfxAudioResourcePack.current().events().get(id);
        if (sound == null || event == null) return false;
        var listener = Minecraft.getInstance().getCameraEntity();
        if (listener == null || !Double.isFinite(position.x) || !Double.isFinite(position.y)
                || !Double.isFinite(position.z) || listener.distanceToSqr(position) > sound.range() * sound.range()) return false;
        Key key = new Key(owner, "hit:" + sequence, nextVoiceId++);
        enforceVoiceLimits(owner);
        ACTIVE.put(key, BACKEND.play(sound, event, position, target));
        return true;
    }
    public static boolean acceptHit(UUID attacker, UUID targetId, String modelId, String animation,
                                    int segmentIndex, Vec3 position, long sequence) {
        ClientLevel level = Minecraft.getInstance().level;
        if (level == null || attacker == null || targetId == null) return false;
        Entity target = VfxClientRuntime.findEntity(level, targetId);
        return playHit(attacker, modelId, animation, segmentIndex, position, target, sequence);
    }
    public static void tick(ClientLevel level){
        ACTIVE.entrySet().removeIf(e->!BACKEND.active(e.getValue()));
        if(Minecraft.getInstance().isPaused()) return;
        for(var action:QUEUE.drain()) {
            if(!ready || action.session()!=QUEUE.session()) continue;
            if(action.sound()==null) {
                stopSlot(action.owner(), action.slot());
                continue;
            }
            Key key=new Key(action.owner(),action.slot(),nextVoiceId++);
            var sound=catalog.sounds().get(action.sound());
            var event=VfxAudioResourcePack.current().events().get(action.sound());
            var owner=VfxClientRuntime.findEntity(level,action.owner());
            if(sound==null || event==null || owner==null || owner.isRemoved()) continue;
            enforceVoiceLimits(action.owner());
            ACTIVE.put(key,BACKEND.play(sound,event,owner));
        }
    }
    private static void enforceVoiceLimits(UUID owner) {
        while(ACTIVE.keySet().stream().filter(k->k.owner().equals(owner)).count()>=8)
            evict(ACTIVE.keySet().stream().filter(k->k.owner().equals(owner)).findFirst().orElseThrow());
        while(ACTIVE.size()>=32) evict(ACTIVE.keySet().iterator().next());
    }
    private static boolean stopSlot(UUID owner, String slot) {
        boolean stopped = false;
        var iterator = ACTIVE.entrySet().iterator();
        while (iterator.hasNext()) {
            var entry = iterator.next();
            if (entry.getKey().owner().equals(owner) && entry.getKey().slot().equals(slot)) {
                BACKEND.stop(entry.getValue()); iterator.remove(); stopped = true;
            }
        }
        return stopped;
    }
    private static void evict(Key key){var voice=ACTIVE.remove(key);if(voice!=null) BACKEND.stop(voice);}
    public static void clear(){QUEUE.invalidate();ACTIVE.values().forEach(BACKEND::stop);ACTIVE.clear();}
    public static void unload(){ready=false;clear();catalog=AudioCatalog.EMPTY;
        com.elfmcys.ysmvfx.client.VfxClientPacketHandler.clear();}
    /** Prepare+apply reload; no-arg SoundManager.reload() does not read sounds.json. */
    public static CompletableFuture<Void> reloadSounds(){
        var mc=Minecraft.getInstance();
        return mc.getSoundManager().reload(new PreparableReloadListener.PreparationBarrier(){
            @Override public <T> CompletableFuture<T> wait(T value){return CompletableFuture.completedFuture(value);}
        }, mc.getResourceManager(),InactiveProfiler.INSTANCE,InactiveProfiler.INSTANCE,net.minecraft.Util.backgroundExecutor(),mc);
    }
}
