import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Bad Request",
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ── Shared schemas ────────────────────────────────────────────

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const FarmerCreateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  gender: z.enum(["Male", "Female", "Other"]),
  phone: z.string().max(30).optional().nullable(),
  nationalId: z.string().max(50).optional().nullable(),
  districtId: z.number().int().positive().optional().nullable(),
  chiefdomId: z.number().int().positive().optional().nullable(),
  sectionId: z.number().int().positive().optional().nullable(),
  communityId: z.number().int().positive().optional().nullable(),
  valueChainId: z.number().int().positive().optional().nullable(),
  farmSize: z.number().positive().optional().nullable(),
  gpsLatitude: z.number().min(-90).max(90).optional().nullable(),
  gpsLongitude: z.number().min(-180).max(180).optional().nullable(),
  photoUrl: z.string().max(500).optional().nullable(),
  ageGroup: z.string().max(50).optional().nullable(),
  farmerGroup: z.string().max(100).optional().nullable(),
});

export const PodSubmitSchema = z.object({
  farmerId: z.number().int().positive(),
  campaignId: z.number().int().positive(),
  dispatchId: z.number().int().positive().optional().nullable(),
  quantityDelivered: z.number().positive().optional().nullable(),
  farmerLatitude: z.number().min(-90).max(90).optional().nullable(),
  farmerLongitude: z.number().min(-180).max(180).optional().nullable(),
  vehicleLatitude: z.number().min(-90).max(90).optional().nullable(),
  vehicleLongitude: z.number().min(-180).max(180).optional().nullable(),
  photoUrl: z.string().max(500).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const OtpSendSchema = z.object({
  farmerId: z.number().int().positive(),
});

export const OtpVerifySchema = z.object({
  farmerId: z.number().int().positive(),
  code: z.string().length(6).regex(/^\d{6}$/),
});
