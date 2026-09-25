<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddMfaToUsersTable extends Migration
{
    public function up()
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('mfa_enabled')->default(false);
            $table->text('otp_hash')->nullable();
            $table->timestampTz('otp_expires_at')->nullable();
            $table->unsignedTinyInteger('otp_attempts')->default(0);
        });
    }

    public function down()
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['mfa_enabled', 'otp_hash', 'otp_expires_at', 'otp_attempts']);
        });
    }
}
