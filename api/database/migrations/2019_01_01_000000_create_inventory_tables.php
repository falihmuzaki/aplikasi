<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateInventoryTables extends Migration
{
    public function up()
    {
        if (!Schema::hasTable('products')) {
            Schema::create('products', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->string('name', 160);
                $table->string('category', 80);
                $table->decimal('price', 12, 2)->default(0);
                $table->integer('stock')->default(0);
                $table->string('status', 20)->default('Active');
                $table->string('media_name')->nullable();
                $table->string('media_type', 100)->nullable();
                $table->text('media_url')->nullable();
                $table->timestampsTz();
            });
        }

        if (!Schema::hasTable('users')) {
            Schema::create('users', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->string('name', 120);
                $table->string('email')->unique();
                $table->text('password_hash');
                $table->string('role', 30)->default('admin');
                $table->boolean('is_active')->default(true);
                $table->timestampsTz();
            });
        }
    }

    public function down()
    {
        Schema::dropIfExists('products');
        Schema::dropIfExists('users');
    }
}
