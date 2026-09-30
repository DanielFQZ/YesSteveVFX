package com.elfmcys.ysmvfx.audio;

import com.elfmcys.ysmvfx.YesSteveVfx;
import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.*;
import net.minecraft.server.packs.repository.*;
import net.minecraft.server.packs.metadata.MetadataSectionSerializer;
import net.minecraft.server.packs.metadata.pack.PackMetadataSection;
import net.minecraft.server.packs.resources.IoSupplier;
import net.minecraft.network.chat.Component;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.event.AddPackFindersEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

@Mod.EventBusSubscriber(modid=YesSteveVfx.MOD_ID, value=Dist.CLIENT, bus=Mod.EventBusSubscriber.Bus.MOD)
public final class VfxAudioResourcePack implements PackResources {
    public record Prepared(AudioCatalog catalog, Map<String, byte[]> resources, Map<String, ResourceLocation> events) { }
    public static final Prepared EMPTY = new Prepared(AudioCatalog.EMPTY, Map.of("sounds.json", "{}".getBytes(StandardCharsets.UTF_8)), Map.of());
    private static volatile Prepared current = EMPTY;
    public static Prepared current() { return current; }
    public static void publish(Prepared snapshot) { current = snapshot; }
    public static Prepared prepare(AudioCatalog catalog, long generation) throws IOException {
        Map<String,byte[]> resources = new LinkedHashMap<>();
        Map<String,ResourceLocation> events = new LinkedHashMap<>();
        JsonObject root = new JsonObject(); long decoded=0; int index=0;
        Map<SoundFile, String> files = new HashMap<>();
        for (var sound : catalog.sounds().values()) {
            var key = new SoundFile(sound.assets(), sound.file());
            String file = files.get(key);
            if (file == null) {
                file="vfx_audio/g"+generation+"/"+index++;
                byte[] bytes=sound.assets().read(sound.file());
                try { decoded+=OggValidation.validate(bytes); }
                catch (IOException e) { throw new IOException(sound.id()+" ("+sound.file()+"): "+e.getMessage(), e); }
                if(decoded>64L*1024*1024) throw new IOException("Decoded audio exceeds 64 MiB");
                files.put(key,file); resources.put("sounds/"+file+".ogg",bytes);
            }
            String event="vfx_audio/g"+generation+"/event_"+events.size();
            JsonObject definition=new JsonObject(), entry=new JsonObject(); JsonArray variants=new JsonArray();
            entry.addProperty("name","yesstevevfx:"+file);
            entry.addProperty("attenuation_distance",(int)Math.ceil(sound.range()));
            entry.addProperty("preload",true);
            variants.add(entry); definition.add("sounds",variants); root.add(event,definition);
            events.put(sound.id(),new ResourceLocation("yesstevevfx",event));
        }
        resources.put("sounds.json",root.toString().getBytes(StandardCharsets.UTF_8));
        return new Prepared(catalog, Map.copyOf(resources), Map.copyOf(events));
    }
    private record SoundFile(com.elfmcys.ysmvfx.asset.PackAssets pack, String path) { }
    @SubscribeEvent public static void discover(AddPackFindersEvent event) {
        if(event.getPackType()!=PackType.CLIENT_RESOURCES) return;
        event.addRepositorySource(out -> {
            Pack pack=Pack.readMetaAndCreate("yesstevevfx_audio",Component.literal("YesSteveVFX sounds"),true,
                    id->new VfxAudioResourcePack(),PackType.CLIENT_RESOURCES,Pack.Position.TOP,PackSource.DEFAULT);
            if(pack!=null) out.accept(pack);
        });
    }
    @Override public IoSupplier<InputStream> getRootResource(String... path) { return null; }
    @Override public IoSupplier<InputStream> getResource(PackType type, ResourceLocation id) {
        if(type!=PackType.CLIENT_RESOURCES || !id.getNamespace().equals("yesstevevfx")) return null;
        byte[] bytes=current.resources().get(id.getPath());
        return bytes==null?null:()->new ByteArrayInputStream(bytes);
    }
    @Override public void listResources(PackType type,String namespace,String prefix,ResourceOutput output) {
        if(type!=PackType.CLIENT_RESOURCES || !namespace.equals("yesstevevfx")) return;
        current.resources().forEach((path,bytes)-> {
            if(path.startsWith(prefix.isEmpty()?"":prefix+"/")) output.accept(new ResourceLocation(namespace,path),()->new ByteArrayInputStream(bytes));
        });
    }
    @Override public Set<String> getNamespaces(PackType type) { return type==PackType.CLIENT_RESOURCES?Set.of("yesstevevfx"):Set.of(); }
    @SuppressWarnings("unchecked") @Override public <T> T getMetadataSection(MetadataSectionSerializer<T> serializer) {
        return serializer==PackMetadataSection.TYPE?(T)new PackMetadataSection(Component.literal("YesSteveVFX sounds"),15):null;
    }
    @Override public String packId(){ return "yesstevevfx_audio"; }
    @Override public void close(){ }
}
