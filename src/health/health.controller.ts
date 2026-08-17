import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: string; db: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", db: "up" };
    } catch {
      throw new HttpException(
        { status: "error", db: "down" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
