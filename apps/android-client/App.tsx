import React, { useState, useEffect, useRef } from "react";
import {
  SafeAreaView,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  View,
  TouchableOpacity,
  Platform,
} from "react-native";
import { io, type Socket } from "socket.io-client";
import type { KeyboardMessage } from "./src/protocol";

const signalingUrl = "http://10.0.2.2:8787";

export default function App() {
  const [pairingId, setPairingId] = useState("");
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [text, setText] = useState("");
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const [targetDeviceId, setTargetDeviceId] = useState("");
  const [rtt, setRtt] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const joinPairing = async () => {
    if (!pairingId.trim() || !secret.trim()) {
      setStatus("Enter both the pairing ID and secret");
      return;
    }
    try {
      setStatus("Joining pairing...");
      const response = await fetch(`${signalingUrl}/pairing/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairingId: pairingId.trim(),
          secret: secret.trim(),
          deviceId: `android-${Date.now()}`,
          deviceName: "Android phone"
        })
      });
      const body = await response.json();
      if (!response.ok) {
        setStatus(body.error === "pairing_already_used" ? "Pairing code already used" : "Pairing failed");
        return;
      }
      setTargetDeviceId(body.ownerDeviceId);
      setStatus(`Paired with ${body.ownerDeviceName}; connecting...`);
      connectSocket(body.ownerDeviceId);
    } catch {
      setStatus("Could not reach signaling server");
    }
  };

  const connectSocket = (ownerDeviceId: string) => {
    const deviceId = `android-${Date.now()}`;
    const socket = io(signalingUrl, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("auth.device", {
        deviceId,
        deviceName: "Android phone",
        publicKey: `android-public-key-${deviceId}`
      }, (auth: any) => {
        if (auth?.ok) {
          socket.emit("session.request", { targetDeviceId: ownerDeviceId, pairingId: pairingId.trim() });
        } else {
          setStatus("Device authentication failed");
        }
      });
    });

    socket.on("session.approve", () => {
      setConnected(true);
      setStatus("Connected to PC");
    });

    socket.on("session.reject", () => {
      setStatus("Windows PC rejected the connection");
    });

    socket.on("session.end", () => {
      setConnected(false);
      socket.disconnect();
      socketRef.current = null;
      setStatus("Disconnected");
    });

    socket.on("desktop.controlAck", (payload: any) => {
      if (payload?.type === "ping") {
        const latency = Date.now() - (payload.sentAt || Date.now());
        setRtt(latency);
      }
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setStatus("Signaling disconnected");
    });

    socket.on("error", (err: any) => {
      setStatus(`Error: ${err?.error || err.message || String(err)}`);
    });

    // Heartbeat to measure RTT
    const pingInterval = setInterval(() => {
      if (connected && targetDeviceId) {
        socket.emit("desktop.control", { type: "ping", targetDeviceId, sentAt: Date.now() });
      }
    }, 1000);
    return () => clearInterval(pingInterval);
  };

  const sendControl = (control: Record<string, unknown>) => {
    if (!connected || !targetDeviceId || !socketRef.current) {
      setStatus("Not connected to PC");
      return;
    }
    socketRef.current.emit("desktop.control", { ...control, targetDeviceId });
  };

  const sendKey = (key: string, modifiers?: ("Ctrl" | "Alt" | "Shift")[]) => {
    sendControl({ type: "key", key, modifiers });
  };

  const sendText = (value: string) => {
    if (!value) return;
    sendControl({ type: "text", text: value });
    setText("");
  };

  const isTablet = Platform.OS === "android" && (() => {
    try {
      const { width, height } = require("react-native").Dimensions.get("window");
      return Math.min(width, height) >= 600;
    } catch { return false; }
  })();

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Remote Control</Text>
      <View style={styles.statusRow}>
        <Text style={[styles.statusText, connected && styles.statusConnected]}>
          {connected ? "🟢 Connected" : rtt != null ? `🟡 ${rtt} ms` : "⚪ " + status}
        </Text>
      </View>
      {!connected ? (
        <>
          <TextInput
            value={pairingId}
            onChangeText={setPairingId}
            placeholder="Pairing ID"
            autoCapitalize="characters"
            style={styles.input}
          />
          <TextInput
            value={secret}
            onChangeText={setSecret}
            placeholder="Pairing secret"
            style={styles.input}
          />
          <Pressable style={styles.button} onPress={joinPairing} disabled={!pairingId.trim() || !secret.trim()}>
            <Text style={styles.buttonText}>Pair computer</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.subtitle}>Remote keyboard</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type to send to the PC"
            style={styles.input}
            onSubmitEditing={() => sendText(text)}
            autoCapitalize="none"
            spellCheck={false}
          />
          <Pressable style={styles.button} onPress={() => sendText(text)}>
            <Text style={styles.buttonText}>Send</Text>
          </Pressable>
          <View style={styles.keyrow}>
            <TouchableOpacity style={styles.key} onPress={() => sendKey("Enter")}>
              <Text style={styles.keyText}>Enter</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.key} onPress={() => sendKey("Backspace")}>
              <Text style={styles.keyText}>⌫</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.key} onPress={() => sendKey("Tab")}>
              <Text style={styles.keyText}>Tab</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.key} onPress={() => sendKey("Escape")}>
              <Text style={styles.keyText}>Esc</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.keyrow}>
            <TouchableOpacity style={styles.key} onPress={() => sendKey("ArrowUp")}>
              <Text style={styles.keyText}>▲</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.keyrow}>
            <TouchableOpacity style={styles.key} onPress={() => sendKey("ArrowLeft")}>
              <Text style={styles.keyText}>◀</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.key} onPress={() => sendKey("ArrowDown")}>
              <Text style={styles.keyText}>▼</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.key} onPress={() => sendKey("ArrowRight")}>
              <Text style={styles.keyText}>▶</Text>
            </TouchableOpacity>
          </View>
          <Pressable style={styles.disconnect} onPress={() => {
            socketRef.current?.emit("session.end", { targetDeviceId });
            setConnected(false);
            socketRef.current?.disconnect();
            socketRef.current = null;
            setStatus("Disconnected");
          }}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center" },
  statusRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  statusText: { fontSize: 14, color: "#888" },
  statusConnected: { color: "#4ade80", fontWeight: "600" },
  subtitle: { fontSize: 16, fontWeight: "600", marginTop: 8 },
  input: { borderWidth: 1, borderColor: "#334155", borderRadius: 8, padding: 12, color: "#fff", backgroundColor: "#111827" },
  button: { backgroundColor: "#2563eb", padding: 14, borderRadius: 8, alignItems: "center", marginVertical: 6 },
  buttonText: { color: "white", fontWeight: "600" },
  disconnect: { backgroundColor: "#ef4444", padding: 12, borderRadius: 8, alignItems: "center", marginTop: 12 },
  disconnectText: { color: "white", fontWeight: "600" },
  keyrow: { flexDirection: "row", justifyContent: "space-between", marginVertical: 6 },
  key: { flex: 1, backgroundColor: "#334155", padding: 14, borderRadius: 8, marginHorizontal: 3, alignItems: "center" },
  keyText: { color: "#fff", fontWeight: "600" },
});
