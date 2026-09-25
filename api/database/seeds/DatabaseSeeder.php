<?php

use App\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * @return void
     */
    public function run()
    {
        User::updateOrCreate(
            ['email' => env('ADMIN_EMAIL', 'admin@lumina.test')],
            [
                'name' => env('ADMIN_NAME', 'Administrator'),
                'password_hash' => Hash::make(env('ADMIN_PASSWORD', 'change-me-now')),
                'role' => 'admin',
                'is_active' => true,
            ]
        );
    }
}
