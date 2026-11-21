import "reflect-metadata";
import {
  ArgumentsHost,
  BadRequestException,
  Body,
  CanActivate,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  ExecutionContext,
  Get,
  Headers,
  Injectable,
  HttpCode,
  HttpException,
  Module,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiProperty,
  DocumentBuilder,
  SwaggerModule,
} from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { maxBytes } from "./files";
import { MediLedger } from "./service";
import { ledgerPrincipal, missing } from "./ledger";

class LoginDto {
  @ApiProperty({ format: "email" }) @IsEmail() @Length(3, 254) email!: string;
  @ApiProperty({ format: "password" })
  @IsString()
  @Length(1, 72)
  password!: string;
}

class SubjectDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() subject!: string;
}

const demoAccounts = ["patient", "provider", "issuer", "auditor"] as const;

class DemoEntryDto {
  @ApiProperty({ enum: [...demoAccounts] })
  @IsIn(demoAccounts)
  account!: (typeof demoAccounts)[number];
}

class AccountStatusDto {
  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}

function offsetOf(value?: string) {
  if (value === undefined) return 0;
  if (!/^\d{1,6}$/.test(value))
    throw new BadRequestException("Invalid page offset");
  return Number(value);
}

const uuid = new ParseUUIDPipe();
const pdf = FileInterceptor("file", {
  limits: { fileSize: maxBytes, files: 1, fields: 1, fieldSize: 128 },
});

@Injectable()
class AuthenticatedUpload implements CanActivate {
  constructor(private readonly app: MediLedger) {}
  async canActivate(context: ExecutionContext) {
    await this.app.session(
      context.switchToHttp().getRequest<Request>().headers.authorization,
    );
    return true;
  }
}

const uploadSchema = { type: "string", format: "binary" };

@Controller()
class Api {
  constructor(private readonly app: MediLedger) {}
  private async actor(auth?: string) {
    return (await this.app.session(auth)).actor;
  }

  @Get("health")
  async health(@Res({ passthrough: true }) response: Response) {
    const checks = await Promise.allSettled([
      this.app.db.$queryRaw`SELECT 1`,
      this.app.mode === "LIVE_FABRIC"
        ? this.app.ledger.ping()
        : Promise.resolve(),
    ]);
    const database = checks[0].status === "fulfilled";
    const ledger = checks[1].status === "fulfilled";
    if (!database || !ledger) response.status(503);
    return {
      mode: this.app.mode,
      database,
      ledger:
        this.app.mode === "PUBLIC_DEMO"
          ? "SIMULATED"
          : ledger
            ? "AVAILABLE"
            : "UNAVAILABLE",
    };
  }

  @Post("auth/login")
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.app.login(body.email, body.password);
  }

  @Post("auth/demo")
  @HttpCode(200)
  demoEntry(@Body() body: DemoEntryDto) {
    const password = process.env.FIXTURE_PASSWORD;
    if (
      this.app.mode !== "PUBLIC_DEMO" ||
      process.env.DEMO_ACCOUNT_ENTRY !== "true" ||
      !password
    )
      throw missing();
    return this.app.login(body.account + "@mediledger.example", password);
  }

  @ApiBearerAuth()
  @Post("auth/logout")
  @HttpCode(204)
  logout(@Headers("authorization") auth?: string) {
    return this.app.logout(auth);
  }

  @ApiBearerAuth()
  @Get("users/me")
  async me(@Headers("authorization") auth?: string) {
    const { actor, name, email, department } = await this.app.session(auth);
    return { ...actor, name, email, department, mode: this.app.mode };
  }

  @ApiBearerAuth()
  @Get("users/directory")
  async directory(@Headers("authorization") auth?: string) {
    return this.app.directory(await this.actor(auth));
  }

  @ApiBearerAuth()
  @Get("workspace/overview")
  async overview(@Headers("authorization") auth?: string) {
    return this.app.overview(await this.actor(auth));
  }

  @ApiBearerAuth()
  @Get("workspace/staff")
  async staff(
    @Query("offset") offset?: string,
    @Headers("authorization") auth?: string,
  ) {
    return this.app.workspaces.staff(await this.actor(auth), offsetOf(offset));
  }

  @ApiBearerAuth()
  @Patch("workspace/staff/:id")
  @HttpCode(204)
  async staffStatus(
    @Param("id", uuid) id: string,
    @Body() body: AccountStatusDto,
    @Headers("authorization") auth?: string,
  ) {
    await this.app.workspaces.setStaffActive(
      await this.actor(auth),
      id,
      body.active,
    );
  }

  @ApiBearerAuth()
  @Get("workspace/audit")
  async audit(
    @Query("offset") offset?: string,
    @Query("action") action?: string,
    @Headers("authorization") auth?: string,
  ) {
    if (
      action !== undefined &&
      ![
        "RegisterRecord",
        "GrantAccess",
        "RevokeAccess",
        "VerifyDocumentHash",
      ].includes(action)
    )
      throw new BadRequestException("Invalid event type");
    return this.app.workspaces.audit(
      await this.actor(auth),
      offsetOf(offset),
      action,
    );
  }

  @ApiBearerAuth()
  @Get("workspace/verifications")
  async verifications(
    @Query("offset") offset?: string,
    @Headers("authorization") auth?: string,
  ) {
    return this.app.workspaces.verificationHistory(
      await this.actor(auth),
      offsetOf(offset),
    );
  }

  @ApiBearerAuth()
  @Get("records")
  async list(
    @Query("cursor") cursor: string | undefined,
    @Headers("authorization") auth: string | undefined,
    @Query("search") search?: string,
  ) {
    if (
      typeof search !== "undefined" &&
      (typeof search !== "string" || search.length > 120)
    )
      throw new BadRequestException("Invalid search");
    if (cursor !== undefined && !/^[a-f0-9-]{36}$/.test(cursor))
      throw new BadRequestException("Invalid cursor");
    return this.app.list(await this.actor(auth), cursor, search?.trim());
  }

  @ApiBearerAuth()
  @Get("patients/me/records")
  async patientRecords(
    @Query("cursor") cursor: string | undefined,
    @Headers("authorization") auth?: string,
  ) {
    if ((await this.actor(auth)).role !== "PATIENT") throw missing();
    return this.list(cursor, auth);
  }

  @ApiBearerAuth()
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["subject", "file"],
      properties: {
        subject: { type: "string", format: "uuid" },
        file: uploadSchema,
      },
    },
  })
  @Post("records")
  @UseGuards(AuthenticatedUpload)
  @UseInterceptors(pdf)
  async register(
    @Body() body: SubjectDto,
    @UploadedFile() file?: Express.Multer.File,
    @Headers("authorization") auth?: string,
  ) {
    if (
      this.app.mode === "PUBLIC_DEMO" &&
      process.env.DEMO_FIXTURES_ONLY === "true"
    ) {
      throw new BadRequestException(
        "This demo uses pre-seeded reports. Open the patient account to try consent.",
      );
    }
    return this.app.register(await this.actor(auth), body.subject, file);
  }

  @ApiBearerAuth()
  @Get("records/:id")
  async record(
    @Param("id", uuid) id: string,
    @Headers("authorization") auth?: string,
  ) {
    const actor = await this.actor(auth);
    const { summary, state } = await this.app.authorized(actor, id);
    return {
      ...summary,
      grants:
        state.owner === ledgerPrincipal(actor)
          ? state.grants.map((ref) => ref.split(":")[1])
          : [],
    };
  }

  @ApiBearerAuth()
  @Get("records/:id/history")
  async history(
    @Param("id", uuid) id: string,
    @Headers("authorization") auth?: string,
  ) {
    return (await this.app.authorized(await this.actor(auth), id)).state
      .history;
  }

  @ApiBearerAuth()
  @Get("records/:id/document")
  async download(
    @Param("id", uuid) id: string,
    @Res() response: Response,
    @Headers("authorization") auth?: string,
  ) {
    const { summary } = await this.app.authorized(await this.actor(auth), id);
    const bytes = await this.app.files.get(id);
    response.attachment(summary.filename).type("application/pdf").send(bytes);
  }

  @ApiBearerAuth()
  @Post("records/:id/grants")
  @HttpCode(204)
  async grant(
    @Param("id", uuid) id: string,
    @Body() body: SubjectDto,
    @Headers("authorization") auth?: string,
  ) {
    await this.app.consent(await this.actor(auth), id, body.subject, true);
  }

  @ApiBearerAuth()
  @Delete("records/:id/grants/:provider")
  @HttpCode(204)
  async revoke(
    @Param("id", uuid) id: string,
    @Param("provider", uuid) provider: string,
    @Headers("authorization") auth?: string,
  ) {
    await this.app.consent(await this.actor(auth), id, provider, false);
  }

  @ApiBearerAuth()
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: { file: uploadSchema },
    },
  })
  @Post("records/:id/verify")
  @HttpCode(200)
  @UseGuards(AuthenticatedUpload)
  @UseInterceptors(pdf)
  async verify(
    @Param("id", uuid) id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Headers("authorization") auth?: string,
  ) {
    return this.app.verify(await this.actor(auth), id, file);
  }
}

@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body =
      error instanceof HttpException
        ? error.getResponse()
        : "Internal server error";
    const message =
      typeof body === "object" && "message" in body ? body.message : body;
    response.status(status).json({
      status,
      message,
      requestId: response.getHeader("X-Request-ID"),
      mode: response.getHeader("X-MediLedger-Mode"),
    });
  }
}

@Module({ controllers: [Api], providers: [MediLedger, AuthenticatedUpload] })
class AppModule {}

async function start() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  const service = app.get(MediLedger);
  app.enableShutdownHooks();
  app.use(helmet());
  app.use((_: Request, response: Response, next: NextFunction) => {
    response.set({
      "X-Request-ID": randomUUID(),
      "X-MediLedger-Mode": service.mode,
      "Cache-Control": "no-store",
    });
    next();
  });
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    exposedHeaders: ["X-MediLedger-Mode", "X-Request-ID"],
  });
  app.use(rateLimit({ limit: 240, windowMs: 60_000 }));
  app.use(
    ["/auth/login", "/auth/demo"],
    rateLimit({ limit: 25, windowMs: 60_000 }),
  );
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new Errors());
  SwaggerModule.setup(
    "docs",
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("MediLedger")
        .setVersion("1.0")
        .addBearerAuth()
        .build(),
    ),
  );
  await app.listen(
    Number(process.env.PORT ?? 3001),
    process.env.BIND_HOST ?? "127.0.0.1",
  );
}

void start().catch(() => {
  console.error(
    "API startup failed. Check APP_MODE, storage and Fabric configuration.",
  );
  process.exitCode = 1;
});
