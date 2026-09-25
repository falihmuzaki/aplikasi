<?php

namespace App;

use Illuminate\Auth\Authenticatable;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Illuminate\Database\Eloquent\Model;

class User extends Model implements AuthenticatableContract
{
    use Authenticatable;

    /**
     * The attributes that are mass assignable.
     *
     * @var array
     */
    protected $table = 'users';

    protected $fillable = ['name', 'email', 'password_hash', 'role', 'is_active', 'mfa_enabled', 'otp_hash', 'otp_expires_at', 'otp_attempts'];

    /**
     * The attributes that should be hidden for arrays.
     *
     * @var array
     */
    protected $hidden = ['password_hash', 'otp_hash'];

    /**
     * The attributes that should be cast to native types.
     *
     * @var array
     */
    protected $casts = ['id' => 'integer', 'is_active' => 'boolean', 'mfa_enabled' => 'boolean', 'otp_attempts' => 'integer', 'otp_expires_at' => 'datetime'];

    public function getAuthPassword()
    {
        return $this->password_hash;
    }
}
