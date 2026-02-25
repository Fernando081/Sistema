import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.username, body.password);
  }

  /**
   * Public registration endpoint.
   *
   * WARNING: This endpoint is publicly accessible and allows anyone to create
   * admin accounts without authentication. This is intended for initial setup
   * and development only.
   *
   * For production deployments:
   * - Remove the @Public() decorator to require authentication
   * - Add rate limiting to prevent abuse
   * - Consider implementing an invite-only system with tokens
   * - Or disable this endpoint after initial admin user creation
   */
  @Public()
  @Post('register')
  async register(@Body() body: RegisterDto) {
    return this.authService.register(
      body.username,
      body.password,
      body.role ?? 'admin',
    );
  }
}
