import "reflect-metadata";
import cookieParser from "cookie-parser";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import {
  assertProductionSecurityConfig,
  constantTimeEqual,
  csrfMiddleware,
  rateLimitMiddleware,
  securityHeadersMiddleware
} from "./common/security";

const PDF_DOWNLOAD_EXPORT_FIX_MARKER = "NMTH_PDF_UI_DOWNLOAD_EXPORT_BODY_LIMIT_8MB";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  assertProductionSecurityConfig(config);
  const webOrigin = config.get<string>("WEB_ORIGIN") ?? "http://localhost:3000";

  app.set("trust proxy", 1);
  app.use(securityHeadersMiddleware(config));
  app.use(rateLimitMiddleware(config));
  app.use(csrfMiddleware(config));
  app.useBodyParser("json", { limit: "8mb" });
  app.useBodyParser("urlencoded", { limit: "8mb", extended: true });
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("X-NMTH-PDF-Export-Fix", PDF_DOWNLOAD_EXPORT_FIX_MARKER);
    next();
  });
  app.setGlobalPrefix("api", { exclude: ["health"] });
  app.enableCors({
    origin: webOrigin,
    credentials: true
  });
  app.use(cookieParser(config.get<string>("COOKIE_SECRET")));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: false
    })
  );

  const swaggerEnabled = process.env.NODE_ENV !== "production" || config.get<string>("ENABLE_SWAGGER") === "true";
  if (swaggerEnabled) {
    if (process.env.NODE_ENV === "production") {
      app.use("/api/docs", (request: Request, response: Response, next: NextFunction) => {
        const expected = config.get<string>("SWAGGER_ADMIN_TOKEN")?.trim();
        const actual = request.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
        if (!expected || !actual || !constantTimeEqual(actual, expected)) {
          response.status(401).send("Swagger documentation requires admin token");
          return;
        }
        next();
      });
    }
    const swaggerConfig = new DocumentBuilder()
      .setTitle("NMTH Climate Monitor API")
      .setDescription("Exhibition temperature and humidity monitoring API")
      .setVersion("0.1.0")
      .addCookieAuth("nmth_session")
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api/docs", app, document);
  }

  const port = Number(config.get<string>("API_PORT") ?? 4000);
  await app.listen(port);
}

void bootstrap();
