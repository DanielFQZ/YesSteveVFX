package com.elfmcys.ysmvfx.audio;

import java.io.IOException;
import java.nio.*;
import org.lwjgl.stb.STBVorbis;
import org.lwjgl.stb.STBVorbisInfo;
import org.lwjgl.system.MemoryStack;
import org.lwjgl.system.MemoryUtil;

/** Validates framing before bounded native decoding. No audio device is needed. */
public final class OggValidation {
    private OggValidation() { }
    public static long validate(byte[] bytes) throws IOException {
        if (bytes.length == 0 || bytes.length > 4 * 1024 * 1024) throw new IOException("Maximum 4 MiB per sound");
        validatePages(bytes);
        ByteBuffer data = MemoryUtil.memAlloc(bytes.length);
        long handle = 0;
        try (MemoryStack stack = MemoryStack.stackPush()) {
            data.put(bytes).flip();
            IntBuffer error = stack.mallocInt(1);
            handle = STBVorbis.stb_vorbis_open_memory(data, error, null);
            if (handle == 0) throw new IOException("Invalid OGG Vorbis (decoder error " + error.get(0) + ")");
            STBVorbisInfo info = STBVorbis.stb_vorbis_get_info(handle, STBVorbisInfo.malloc(stack));
            if (info.channels() != 1) throw new IOException("Spatial sound must be mono; convert stereo to mono first");
            int rate = info.sample_rate();
            if (rate < 8000 || rate > 96000) throw new IOException("Sample rate must be 8000..96000 Hz");
            ShortBuffer chunk = stack.mallocShort(4096);
            long samples = 0;
            int read;
            while ((read = STBVorbis.stb_vorbis_get_samples_short_interleaved(handle, 1, chunk)) > 0) {
                samples += read;
                if (samples > rate * 10L) throw new IOException("Sound exceeds 10 seconds");
            }
            int code = STBVorbis.stb_vorbis_get_error(handle);
            if (code != 0 || samples == 0) throw new IOException("Invalid/empty Vorbis stream, decoder error " + code);
            return samples * 2;
        } finally {
            if (handle != 0) STBVorbis.stb_vorbis_close(handle);
            MemoryUtil.memFree(data);
        }
    }
    static void validatePages(byte[] b) throws IOException {
        int pos = 0, serial = 0, sequence = 0; boolean ended = false;
        while (pos < b.length) {
            if (ended || b.length-pos < 27 || b[pos]!='O' || b[pos+1]!='g' || b[pos+2]!='g' || b[pos+3]!='S' || b[pos+4]!=0)
                throw new IOException("Invalid/truncated Ogg page");
            int flags = b[pos+5] & 255;
            ByteBuffer header = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN);
            int stream = header.getInt(pos+14), seq = header.getInt(pos+18);
            if (pos==0) { serial=stream; if ((flags&2)==0) throw new IOException("Missing Ogg stream start"); }
            if (stream!=serial || seq!=sequence++ || (pos>0 && (flags&2)!=0)) throw new IOException("Chained/discontinuous Ogg streams are unsupported");
            int segments=b[pos+26]&255, size=27+segments;
            if (b.length-pos<size) throw new IOException("Truncated Ogg segment table");
            for(int i=0;i<segments;i++) size+=b[pos+27+i]&255;
            if (b.length-pos<size) throw new IOException("Truncated Ogg payload");
            int crc=0;
            for(int i=0;i<size;i++) {
                crc ^= ((i>=22 && i<26) ? 0 : b[pos+i]&255)<<24;
                for(int bit=0;bit<8;bit++) crc=(crc<<1)^((crc<0)?0x04c11db7:0);
            }
            if (crc!=header.getInt(pos+22)) throw new IOException("Ogg checksum mismatch");
            ended=(flags&4)!=0; pos+=size;
        }
        if (!ended) throw new IOException("Missing Ogg end of stream (truncated file)");
    }
}
