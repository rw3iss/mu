import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
	(data: string | undefined, ctx: ExecutionContext) => {
		const request = ctx.switchToHttp().getRequest();
		const user = request.user;
		if (!data) return user;
		// JWT payload uses 'sub' for user ID — map 'id' to 'sub'
		if (data === 'id') return user?.sub ?? user?.id;
		return user?.[data];
	},
);
