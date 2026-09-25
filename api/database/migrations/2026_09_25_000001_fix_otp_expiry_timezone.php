<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

class FixOtpExpiryTimezone extends Migration
{
    public function up()
    {
        DB::statement("ALTER TABLE users ALTER COLUMN otp_expires_at TYPE timestamp(0) WITHOUT TIME ZONE USING otp_expires_at AT TIME ZONE 'UTC'");
    }

    public function down()
    {
        DB::statement("ALTER TABLE users ALTER COLUMN otp_expires_at TYPE timestamp(0) WITH TIME ZONE USING otp_expires_at AT TIME ZONE 'UTC'");
    }
}
