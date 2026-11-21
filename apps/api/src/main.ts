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
  ValidateIf,
  Matches,
} from "class-validator";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { maxBytes } from "./files";
import { managedRoles, organizationStates } from "./admin";
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

class EmailDto {
  @IsEmail() @Length(3, 254) email!: string;
}
class TokenDto {
  @IsString() @Length(43, 43) token!: string;
}
class ResetDto extends TokenDto {
  @IsString() @Length(12, 72) password!: string;
}
class OrganizationDto {
  @IsString() @Length(2, 120) @Matches(/\S/) name!: string;
  @IsString() @Matches(/^[A-Za-z0-9._-]{2,80}$/) mspId!: string;
}
class OrganizationStateDto {
  @IsIn(organizationStates) status!: (typeof organizationStates)[number];
}
class InvitationDto extends EmailDto {
  @IsString() @Length(1, 80) organizationId!: string;
  @IsIn(managedRoles) role!: (typeof managedRoles)[number];
}
class ManagedUserDto {
  @ValidateIf((_, value) => value !== undefined) @IsBoolean() active?: boolean;
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(managedRoles)
  role?: (typeof managedRoles)[number];
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 80)
  organizationId?: string;
}
class RegistrationDto {
  @IsBoolean() registrationOpen!: boolean;
}
function searchOf(value?: string) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 120)
    throw new BadRequestException("Invalid search.");
  return value.trim();
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

  @Post("auth/signup")
  @HttpCode(204)
  async signup(@Body() body: LoginDto) {
    await this.app.accounts.signup(body.email.toLowerCase(), body.password);
  }

  @Post("auth/forgot-password")
  @HttpCode(204)
  async forgot(@Body() body: EmailDto) {
    await this.app.accounts.recover(body.email.toLowerCase(), "RESET");
  }

  @Post("auth/resend-verification")
  @HttpCode(204)
  async resend(@Body() body: EmailDto) {
    await this.app.accounts.recover(body.email.toLowerCase(), "VERIFY");
  }

  @Post("auth/verify-email")
  @HttpCode(204)
  async verifyEmail(@Body() body: TokenDto) {
    await this.app.accounts.consume(body.token);
  }

  @Post("auth/reset-password")
  @HttpCode(204)
  async reset(@Body() body: ResetDto) {
    await this.app.accounts.consume(body.token, body.password);
  }

  @ApiBearerAuth()
  @Get("auth/sessions")
  sessions(@Headers("authorization") auth?: string) {
    return this.app.sessions(auth);
  }

  @ApiBearerAuth()
  @Delete("auth/sessions/:id")
  @HttpCode(204)
  async revokeSession(
    @Param("id") id: string,
    @Headers("authorization") auth?: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw missing();
    await this.app.revokeSession(auth, id);
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

@Controller("admin")
class AdminApi {
  constructor(private readonly app: MediLedger) {}
  private async actor(auth?: string) {
    return (await this.app.session(auth)).actor;
  }
  @Get("overview")
  async overview(@Headers("authorization") auth?: string) {
    return this.app.admin.stats(await this.actor(auth));
  }
  @Get("organizations")
  async organizations(
    @Query("search") search?: string,
    @Query("offset") offset?: string,
    @Headers("authorization") auth?: string,
  ) {
    return this.app.admin.organizations(
      await this.actor(auth),
      searchOf(search),
      offsetOf(offset),
    );
  }
  @Post("organizations")
  async organization(
    @Body() body: OrganizationDto,
    @Headers("authorization") auth?: string,
  ) {
    return this.app.admin.createOrganization(
      await this.actor(auth),
      body.name.trim(),
      body.mspId.trim(),
    );
  }
  @Patch("organizations/:id")
  @HttpCode(204)
  async organizationState(
    @Param("id") id: string,
    @Body() body: OrganizationStateDto,
    @Headers("authorization") auth?: string,
  ) {
    await this.app.admin.setOrganization(
      await this.actor(auth),
      id,
      body.status,
    );
  }
  @Get("users")
  async users(
    @Query("search") search?: string,
    @Query("offset") offset?: string,
    @Headers("authorization") auth?: string,
  ) {
    return this.app.admin.users(
      await this.actor(auth),
      searchOf(search),
      offsetOf(offset),
    );
  }
  @Post("invitations")
  @HttpCode(204)
  async invite(
    @Body() body: InvitationDto,
    @Headers("authorization") auth?: string,
  ) {
    await this.app.admin.invite(
      await this.actor(auth),
      body.email.toLowerCase(),
      body.organizationId,
      body.role,
    );
  }
  @Patch("users/:id")
  @HttpCode(204)
  async user(
    @Param("id", uuid) id: string,
    @Body() body: ManagedUserDto,
    @Headers("authorization") auth?: string,
  ) {
    await this.app.admin.setUser(await this.actor(auth), id, body);
  }
  @Get("security")
  async security(
    @Query("search") search?: string,
    @Query("offset") offset?: string,
    @Headers("authorization") auth?: string,
  ) {
    return this.app.admin.security(
      await this.actor(auth),
      searchOf(search),
      offsetOf(offset),
    );
  }
  @Patch("settings")
  @HttpCode(204)
  async settings(
    @Body() body: RegistrationDto,
    @Headers("authorization") auth?: string,
  ) {
    await this.app.admin.settings(
      await this.actor(auth),
      body.registrationOpen,
    );
  }
  @Get("records/:id")
  async recordMetadata(
    @Param("id", uuid) id: string,
    @Headers("authorization") auth?: string,
  ) {
    return this.app.administrativeRecord(await this.actor(auth), id);
  }

  @Get("security/integrity")
  async integrity(@Headers("authorization") auth?: string) {
    return this.app.admin.verifyHistory(await this.actor(auth));
  }
  @Get("export")
  async exportAudit(
    @Query("offset") offset?: string,
    @Headers("authorization") auth?: string,
  ) {
    const actor = await this.actor(auth);
    const start = offsetOf(offset);
    await this.app.admin.logExport(actor, start);
    const [security, documents] = await Promise.all([
      this.app.admin.security(actor, "", start),
      this.app.workspaces.audit(actor, start),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      mode: this.app.mode,
      offset: start,
      security,
      documents,
    };
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

@Module({
  controllers: [Api, AdminApi],
  providers: [MediLedger, AuthenticatedUpload],
})
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
    [
      "/auth/login",
      "/auth/signup",
      "/auth/forgot-password",
      "/auth/resend-verification",
      "/auth/verify-email",
      "/auth/reset-password",
    ],
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
