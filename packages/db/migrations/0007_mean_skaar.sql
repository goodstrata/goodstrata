CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"client_id" text,
	"user_id" text,
	"scopes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_access_tokens_accessToken_unique" UNIQUE("access_token"),
	CONSTRAINT "oauth_access_tokens_refreshToken_unique" UNIQUE("refresh_token")
);
--> statement-breakpoint
CREATE TABLE "oauth_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"metadata" text,
	"client_id" text NOT NULL,
	"client_secret" text,
	"redirect_urls" text NOT NULL,
	"type" text NOT NULL,
	"disabled" boolean DEFAULT false,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_applications_clientId_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"user_id" text,
	"scopes" text,
	"consent_given" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_applications" ADD CONSTRAINT "oauth_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;