import { QdrantClient } from "@qdrant/js-client-rest";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const url = process.env.QDRANT_URL;
const apiKey = process.env.QDRANT_API_KEY;

const PRO_POSES = [
  {
    name: "Virat Kohli",
    role: "Professional Batter",
    analysisType: "batting",
    description: "Virat's front-foot cover drive is textbook perfection. Focus on leaning into the ball, keeping a stable head, and pointing your lead elbow high toward the bowler.",
    vector: [155, 12, 120, 15]
  },
  {
    name: "Steve Smith",
    role: "Professional Batter",
    analysisType: "batting",
    description: "Steve Smith uses a distinct back-and-across trigger movement. Prioritize foot alignment and brace your core to maintain head stability at release.",
    vector: [110, 18, 140, 10]
  },
  {
    name: "Kane Williamson",
    role: "Professional Batter",
    analysisType: "batting",
    description: "Kane Williamson excels at playing the ball late with soft hands directly under his nose. Maintain a compact elbow alignment and relaxed posture.",
    vector: [130, 8, 135, 8]
  },
  {
    name: "Jasprit Bumrah",
    role: "Professional Bowler",
    analysisType: "bowling",
    description: "Jasprit Bumrah features a unique, hyper-extended release with high shoulders. Keep your lead arm high and pull it down forcefully to drive momentum.",
    vector: [175, 25, 160, 45]
  },
  {
    name: "Hardik Pandya",
    role: "Professional Bowler",
    analysisType: "bowling",
    description: "Hardik Pandya utilizes a clean, upright delivery stride with strong front-knee brace. Maintain trunk stability during landing to protect your back.",
    vector: [135, 15, 130, 25]
  },
  {
    name: "Mitchell Starc",
    role: "Professional Bowler",
    analysisType: "bowling",
    description: "Mitchell Starc releases from a towering height with an explosive front-foot block. Focus on maximizing elbow height and driving your follow-through.",
    vector: [170, 20, 150, 40]
  }
];

async function main() {
  if (!url) {
    console.log("QDRANT_URL is not defined in .env. Skipping cloud seed (local in-memory fallback will be used by backend).");
    return;
  }

  console.log(`Connecting to Qdrant Cloud at ${url}...`);
  const qdrant = new QdrantClient({ url, apiKey });

  try {
    console.log("Re-creating collection 'kinectra_poses'...");
    try {
      await qdrant.deleteCollection("kinectra_poses");
    } catch (e) {
      // ignore if doesn't exist
    }

    await qdrant.createCollection("kinectra_poses", {
      vectors: {
        size: 4,
        distance: "Cosine"
      }
    });

    const points = PRO_POSES.map((pose, index) => ({
      id: index + 1,
      vector: pose.vector,
      payload: {
        name: pose.name,
        role: pose.role,
        analysisType: pose.analysisType,
        description: pose.description,
        idealVector: pose.vector
      }
    }));

    await qdrant.upsert("kinectra_poses", {
      wait: true,
      points
    });

    console.log("Successfully seeded 6 professional poses on Qdrant Cloud!");
  } catch (err) {
    console.error("Error during Qdrant Cloud seeding:", err);
  }
}

main();
