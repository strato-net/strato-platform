import { Request, Response, NextFunction } from "express";
import Joi from "@hapi/joi";
import { sendMetalsInquiry } from "../services/contact.service";

const metalsInquirySchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required(),
  email: Joi.string().email().required(),
  message: Joi.string().trim().min(1).max(5000).required(),
});

class ContactController {
  static async submitMetalsInquiry(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { error, value } = metalsInquirySchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        const messages = error.details.map((d) => d.message).join("; ");
        res.status(400).json({ error: messages });
        return;
      }

      await sendMetalsInquiry(value);

      res.json({ success: true, message: "Your message has been sent." });
    } catch (err: any) {
      next(err);
    }
  }
}

export default ContactController;
