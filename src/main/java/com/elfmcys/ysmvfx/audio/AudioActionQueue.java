package com.elfmcys.ysmvfx.audio;
import java.util.*;
/** Session invalidation and enqueue are atomic, including worker-thread Molang calls. */
public final class AudioActionQueue {
    public record Action(UUID owner, String slot, String sound, long session) { }
    private final ArrayDeque<Action> queue=new ArrayDeque<>();
    private long session;
    public synchronized long session(){return session;}
    public synchronized boolean offer(UUID owner,String slot,String sound,long expectedSession) {
        if(owner==null || (slot==null || !slot.matches("[a-zA-Z0-9_.-]{1,64}")) || session!=expectedSession || queue.size()>=256) return false;
        queue.add(new Action(owner,slot,sound,session)); return true;
    }
    public synchronized List<Action> drain(){var result=List.copyOf(queue);queue.clear();return result;}
    public synchronized void invalidate(){session++;queue.clear();}
}
