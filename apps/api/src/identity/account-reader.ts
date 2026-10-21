import { Injectable } from '@nestjs/common';
import {
  accountSchema,
  resolveAccountManagement,
  resolveAppAccess,
  SUPPORTED_PROFILE_LOCALE,
  type AccountView,
} from '@meutreino/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountReader {
  constructor(private readonly prisma: PrismaService) {}

  async present(userId: string): Promise<AccountView> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        profile: true,
        authIdentities: { orderBy: { createdAt: 'asc' } },
        subscriptions: true,
      },
    });
    const profile = user.profile;
    if (!profile) {
      throw new Error('User profile is missing.');
    }
    const entitlement = resolveAppAccess(
      user.subscriptions.map((subscription) => ({
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      })),
      new Date(),
    );
    return accountSchema.parse({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      status: user.status,
      profile: {
        displayName: profile.displayName,
        locale: SUPPORTED_PROFILE_LOCALE,
        weightUnit: profile.weightUnit,
        distanceUnit: profile.distanceUnit,
        theme: profile.theme,
        timeZone: profile.timeZone,
        notifyProductEmail: profile.notifyProductEmail,
        hasPhoto: profile.photoAssetId !== null,
      },
      identities: user.authIdentities.map((identity) => ({
        id: identity.id,
        provider: identity.provider,
        createdAt: identity.createdAt.toISOString(),
      })),
      entitlement,
      accountManagement: {
        allowed: resolveAccountManagement(user.status).allowed,
      },
    });
  }
}
