import AgoraRTC, { IAgoraRTCClient, IMicrophoneAudioTrack, IAgoraRTCRemoteUser } from "agora-rtc-sdk-ng";

export class AgoraService {
  private client: IAgoraRTCClient | null = null;
  private localAudioTrack: IMicrophoneAudioTrack | null = null;
  private onStatusChange: ((status: string) => void) | null = null;

  constructor(
    private appId: string,
    private channelName: string,
    private token: string,
    private uid: number
  ) {
    if (appId && appId !== "undefined" && appId.trim() !== "") {
      AgoraRTC.setLogLevel(3); // Warning and errors only
      this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    }
  }

  registerStatusCallback(cb: (status: string) => void) {
    this.onStatusChange = cb;
  }

  async joinChannel(): Promise<void> {
    if (!this.client) {
      console.warn("Agora App ID is empty. AgoraService operating in local mock mode.");
      if (this.onStatusChange) {
        this.onStatusChange("Connected (Local Fallback Mode)");
      }
      return;
    }

    if (this.onStatusChange) {
      this.onStatusChange("Connecting...");
    }

    // Set up listeners for remote audio streams (Agent voice)
    this.client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      await this.client!.subscribe(user, mediaType);
      if (mediaType === "audio" && user.audioTrack) {
        console.log("Subscribed to remote audio stream from user:", user.uid);
        user.audioTrack.play();
        if (this.onStatusChange) {
          this.onStatusChange("Coach Aryan Speaking...");
        }
      }
    });

    this.client.on("user-unpublished", (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      if (mediaType === "audio" && this.onStatusChange) {
        this.onStatusChange("Connected (Listening)");
      }
    });

    // Join RTC Channel
    await this.client.join(this.appId, this.channelName, this.token, this.uid);

    // Create and publish local mic track
    try {
      this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      await this.client.publish([this.localAudioTrack]);
      console.log("Successfully published local audio stream to channel.");
      if (this.onStatusChange) {
        this.onStatusChange("Connected (Listening)");
      }
    } catch (err) {
      console.error("Microphone access denied or failed to publish track:", err);
      if (this.onStatusChange) {
        this.onStatusChange("Connected (Speaker Only - Mic Muted)");
      }
      throw err;
    }
  }

  async setMute(muted: boolean): Promise<void> {
    if (this.localAudioTrack) {
      await this.localAudioTrack.setEnabled(!muted);
      if (this.onStatusChange) {
        this.onStatusChange(muted ? "Muted" : "Connected (Listening)");
      }
    }
  }

  async leaveChannel(): Promise<void> {
    try {
      if (this.localAudioTrack) {
        this.localAudioTrack.stop();
        this.localAudioTrack.close();
        this.localAudioTrack = null;
      }
      if (this.client) {
        await this.client.leave();
      }
      if (this.onStatusChange) {
        this.onStatusChange("Disconnected");
      }
    } catch (err) {
      console.error("Failed to clean up Agora connections:", err);
    }
  }
}
export default AgoraService;
