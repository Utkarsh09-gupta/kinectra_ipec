import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionRouter from "./session";
import authRouter from "./auth";
import poseRouter from "./pose";
import signatureRouter from "./signature";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionRouter);
router.use("/auth", authRouter);
router.use(poseRouter);
router.use(signatureRouter);

export default router;
