<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddPasswordResetOtpToUsersTable extends Migration
{
    public function up()
    {
        Schema::table('users', function (Blueprint $table) {
            $table->text('password_reset_otp_hash')->nullable();
            $table->timestamp('password_reset_otp_expires_at')->nullable();
            $table->unsignedTinyInteger('password_reset_otp_attempts')->default(0);
        });
    }

    public function down()
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['password_reset_otp_hash', 'password_reset_otp_expires_at', 'password_reset_otp_attempts']);
        });
    }
}
