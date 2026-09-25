<?php

namespace App\Http\Middleware;

use App\User;
use Closure;
use Illuminate\Support\Facades\DB;

class TokenAuth
{
    public function handle($request, Closure $next)
    {
        $header = $request->header('Authorization', '');
        $plainToken = preg_replace('/^Bearer\s+/i', '', $header);

        if (!$plainToken) {
            return response()->json(['message' => 'Authentication token is required.'], 401);
        }

        $record = DB::table('personal_access_tokens')
            ->where('token', hash('sha256', $plainToken))
            ->where(function ($query) {
                $query->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->first();

        if (!$record || $record->tokenable_type !== User::class) {
            return response()->json(['message' => 'Invalid or expired authentication token.'], 401);
        }

        $user = User::find($record->tokenable_id);
        if (!$user || !$user->is_active) {
            return response()->json(['message' => 'User account is inactive.'], 401);
        }

        DB::table('personal_access_tokens')->where('id', $record->id)->update(['last_used_at' => now()]);
        $request->setUserResolver(function () use ($user) {
            return $user;
        });

        return $next($request);
    }
}
