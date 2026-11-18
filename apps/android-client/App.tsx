import React, { useState } from "react";
import { SafeAreaView, Text, TextInput, Pressable, StyleSheet } from "react-native";
import type { KeyboardMessage } from "./src/protocol";

const signalingUrl = "http://10.0.2.2:8787";

export default function App() {
  const [pairingId, setPairingId] = useState("");
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [text, setText] = useState("");

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
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setStatus(body.error === "pairing_already_used" ? "Pairing code already used" : "Pairing failed");
        return;
      }
      const body = await response.json();
      setStatus(`Paired with ${body.ownerDeviceName}; waiting for local confirmation`);
    } catch {
      setStatus("Could not reach signaling server");
    }
  };

  const send = (message: KeyboardMessage) => {
    setStatus(`Input unavailable until WebRTC is implemented (${message.type})`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Remote Control</Text>
      <Text>{status}</Text>
      <TextInput value={pairingId} onChangeText={setPairingId} placeholder="Pairing ID" autoCapitalize="none" style={styles.input} />
      <TextInput value={secret} onChangeText={setSecret} placeholder="Pairing secret" autoCapitalize="none" style={styles.input} />
      <Pressable style={styles.button} onPress={joinPairing}>
        <Text style={styles.buttonText}>Pair computer</Text>
      </Pressable>
      <TextInput value={text} onChangeText={setText} placeholder="Type text remotely" style={styles.input} onSubmitEditing={() => send({ type: "text", text })} />
      <Pressable style={styles.button} onPress={() => send({ type: "key", key: "Enter" })}>
        <Text style={styles.buttonText}>Enter</Text>
      </Pressable>
      <Text style={styles.note}>Pairing is available now. Screen viewing and keyboard control are not connected yet.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#aaa", borderRadius: 8, padding: 12 },
  button: { backgroundColor: "#2563eb", padding: 14, borderRadius: 8 },
  buttonText: { color: "white", textAlign: "center", fontWeight: "600" },
  note: { color: "#555", marginTop: 8 }
});
