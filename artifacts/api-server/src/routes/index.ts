import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import masterDataRouter from "./master-data";
import farmersRouter from "./farmers";
import inventoryRouter from "./inventory";
import campaignsRouter from "./campaigns";
import vehiclesRouter from "./vehicles";
import dispatchRouter from "./dispatch";
import gpsRouter from "./gps";
import podRouter from "./pod";
import reconciliationRouter from "./reconciliation";
import reportsRouter from "./reports";
import auditRouter from "./audit";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(masterDataRouter);
router.use(farmersRouter);
router.use(inventoryRouter);
router.use(campaignsRouter);
router.use(vehiclesRouter);
router.use(dispatchRouter);
router.use(gpsRouter);
router.use(podRouter);
router.use(reconciliationRouter);
router.use(reportsRouter);
router.use(auditRouter);
router.use(usersRouter);

export default router;
